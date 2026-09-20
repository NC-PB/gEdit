"""Shared helpers for gEdit's bundled and user Python scripts (plan section 7.10).

Every public name below is the binding contract: a script written against it keeps
working. The API stub came from the M4 prelude (P4); **WP4.6** filled it in.

What it is for
--------------
A script receives its input on stdin (UTF-8, LF line endings) and everything else
through the JSON file named by the ``GEDIT_CONTEXT`` environment variable. gEdit puts
the bundled scripts folder on ``PYTHONPATH``, so a user script can ``import gedit_nc``
too.

The rules this module lives by:

* **Standard library only.** No pip install, ever. It must run on Python 3.9 as well as
  on the newest release, so no ``match``, no ``X | Y`` at runtime (the ``annotations``
  future import keeps the type hints legal), and no ``dataclasses`` features newer
  than 3.9.
* **Numbers are decimal strings, never floats.** ``10.`` and ``10`` are different
  positions on a Fanuc control, trailing zeros carry the programmer's intent, and the
  TypeScript side (``src/lib/core/nc``) has to reach the same digits. Arithmetic uses
  ``decimal.Decimal`` with ``ROUND_HALF_UP``, which in Python's ``decimal`` means
  **half away from zero** — the same rule the TypeScript side applies to the digits, so
  1111.05 rounds to 1111.1 and -1111.05 to -1111.1 on both sides.
* **The profile decides, not Fanuc.** Comment syntax, addresses, keywords and numbering
  all come out of the context's ``profile``. Nothing here hardcodes a dialect.
* **Patterns are shared.** ``profile`` patterns are written in the common subset of
  ECMAScript and Python ``re`` (plan AD-11); :func:`to_py_regex` bridges the one
  difference that is left, the named-group syntax.

Output
------
A script writes its result to stdout. Which shape depends on the ``output`` field of its
``# /// gedit`` header:

``replace`` / ``new-document``
    the new text, or, with ``envelope = true``, the JSON of :func:`envelope`
``report``
    the JSON of :func:`report`
``panel``
    anything at all

Anything a script wants to say to the developer goes to **stderr**; stdout is the result.

Mirroring the TypeScript core
-----------------------------
:func:`tokenize_line`, :func:`parse_number` and :func:`format_number` are ports of
``src/lib/core/nc/{tokenizer,numbers,numberFormat}.ts`` and are held to the same goldens
(``tests/fixtures/tokens/<profileId>.json``, ``tests/fixtures/numberformat.cases.json``).
Those fixtures are the contract between the two implementations: when one of them has to
change, the fixture changes with it and both sides are re-run. Do not "fix" a difference
on one side only.

One difference is unavoidable and harmless in practice: TypeScript counts UTF-16 code
units and Python counts code points, so ``Token.start`` / ``Token.end`` differ for a line
that holds a character outside the basic plane (an emoji in a comment). Within Python the
offsets are always consistent with the string they came from.

Beyond section 7.10
-------------------
:func:`mask_comments`, :func:`block_number_of`, :func:`normalize_code` and
:func:`number_format_of` are not in the section 7.10 list. They are ports of code the
TypeScript side has as well, and a bundled script needs them; they are public, documented
and covered by the tests, but the contract that may not move is the section 7.10 one.
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from decimal import Decimal, localcontext
from typing import Any, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "NumericLiteral",
    "Token",
    "LineState",
    "CompiledProfile",
    "FeedModeTracker",
    "load_context",
    "read_input",
    "to_py_regex",
    "compile_profile",
    "tokenize_line",
    "parse_number",
    "format_number",
    "scale_decimal",
    "report",
    "envelope",
    # Beyond section 7.10, see the module docstring.
    "mask_comments",
    "block_number_of",
    "normalize_code",
    "number_format_of",
    "CONTEXT_ENV",
    "CONTRACT",
]

#: The environment variable that names the context JSON file.
CONTEXT_ENV = "GEDIT_CONTEXT"

#: The contract version the app writes and this module understands.
CONTRACT = 2


# ---------------------------------------------------------------------------
# Token model — mirrors src/lib/core/nc/types.ts field for field
# ---------------------------------------------------------------------------


@dataclass
class NumericLiteral:
    """A number exactly as it was written.

    ``-10.`` is ``sign='-'``, ``int_part='10'``, ``frac_part=''``, ``has_point=True``;
    ``.5`` is ``int_part=''``, ``frac_part='5'``; ``10`` is ``frac_part=None``,
    ``has_point=False``.
    """

    raw: str
    sign: str  # '+', '-' or ''
    int_part: str
    frac_part: Optional[str]
    has_point: bool


@dataclass
class Token:
    """One token of a block. Same fields as ``NcToken`` in TypeScript.

    ``kind`` is one of ``blockNumber``, ``skip``, ``word``, ``keyword``, ``comment``,
    ``string``, ``variable``, ``expression``, ``operator``, ``continuation``,
    ``programMarker``, ``whitespace``, ``unknown``. ``start`` and ``end`` are offsets
    into the line, ``start`` inclusive and ``end`` exclusive.
    """

    kind: str
    start: int
    end: int
    text: str
    address: Optional[str] = None
    value_text: Optional[str] = None
    value: Optional[NumericLiteral] = None
    incremental: bool = False


@dataclass
class LineState:
    """What one line hands to the next: Klartext's ``~`` continuation, and nothing else."""

    continuation: bool = False


# ---------------------------------------------------------------------------
# The scanner's view of a profile
# ---------------------------------------------------------------------------

_TAB = 0x09
_SPACE = 0x20
_QUOTE = 0x22
_PERCENT = 0x25
_PLUS = 0x2B
_COMMA = 0x2C
_MINUS = 0x2D
_ZERO = 0x30
_NINE = 0x39
_COLON = 0x3A
_STAR = 0x2A
_BRACKET_OPEN = 0x5B
_BRACKET_CLOSE = 0x5D
_NO_CHAR = -1

#: Operators, minus whatever the profile uses to delimit a comment.
_OPERATOR_CHARS = "=+-*/^%:<>|&,()!"


def _is_space(code: int) -> bool:
    """Characters that may stand between two tokens."""
    return code == _SPACE or code == _TAB or code == 0x0B or code == 0x0C or code == 0xA0


def _is_digit(code: int) -> bool:
    return _ZERO <= code <= _NINE


def _is_letter(code: int) -> bool:
    return (0x41 <= code <= 0x5A) or (0x61 <= code <= 0x7A)


def _to_upper(code: int) -> int:
    return code - 32 if 0x61 <= code <= 0x7A else code


def _code_at(line: str, i: int) -> int:
    """``line.charCodeAt(i)``; out of range answers -1, which no test below matches."""
    return ord(line[i]) if 0 <= i < len(line) else _NO_CHAR


@dataclass
class _CommentMarker:
    start: str
    end: Optional[str]
    code: int


@dataclass
class _KeywordEntry:
    """Upper case, one space between the parts; this is what a token reports as ``address``."""

    canonical: str
    parts: List[str]
    #: A one-letter keyword (``L``, ``C``) needs whitespace or the line end behind it.
    single: bool


@dataclass
class _Skip:
    codes: List[int]
    before: bool
    after: bool
    levels: bool


@dataclass
class _LexSpec:
    """Everything the scanner needs from a profile, derived once per compiled profile."""

    packed: bool
    case_sensitive: bool
    comments: List[_CommentMarker]
    #: True when ``"`` opens a string in this dialect (Klartext tool and label names).
    strings: bool
    block_number_mode: str  # 'prefix' | 'leading-integer'
    block_number_prefixes: List[str]
    skip: Optional[_Skip]
    keywords: Dict[int, List[_KeywordEntry]]
    variables: Optional[Any]
    #: The literal first character of ``syntax.variables``, for the Fanuc ``#[…]`` form.
    variable_lead: int
    continuation: Optional[Any]
    section_heading: Optional[Any]
    program_start: List[Any]
    #: Upper-case ``syntax.incrementalPrefix``.
    incremental: int
    decimal_point: int
    operators: frozenset
    #: ``%`` at the head of a line is a tape marker unless the profile uses it otherwise.
    tape_marker: bool
    #: ``:1234`` as a program number, the punched-tape form of ``O1234``.
    colon_program: bool


@dataclass
class CompiledProfile:
    """A profile with its patterns compiled once. Mirrors TypeScript's ``CompiledProfile``.

    ``profile`` is the raw dictionary out of the context, ``flags`` are the ``re`` flags
    every pattern was compiled with (``re.ASCII``, plus ``re.IGNORECASE`` unless
    ``syntax.caseSensitive`` is set), ``patterns`` holds the compiled expressions under
    the same names the TypeScript side uses and ``keywords`` is ``syntax.keywords``
    upper-cased and sorted longest first, so a greedy match finds ``LBL`` before ``L``.

    ``patterns`` in full:

    ===================  ======================================================
    ``detect_content``   ``[(regex, weight), …]``
    ``section_heading``  regex or ``None``
    ``continuation``     regex or ``None``
    ``variables``        regex or ``None``
    ``tool_trigger``     regex
    ``tool``             regex, with the named group ``tool``
    ``program_start``    ``[regex, …]``
    ``program_end``      ``[regex, …]``
    ``outline``          ``[(kind, regex), …]``, in order; the first match wins
    ``references``       ``[(trigger_regex, [address, …]), …]``
    ``comment_filter``   regex or ``None``
    ===================  ======================================================

    ``spec`` is the scanner's derived view, built on first use and cached here.
    """

    profile: Dict[str, Any]
    flags: int = 0
    patterns: Dict[str, Any] = field(default_factory=dict)
    keywords: List[str] = field(default_factory=list)
    spec: Optional[_LexSpec] = None


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def load_context() -> Dict[str, Any]:
    """The ``ScriptContextV2`` dictionary (plan section 7.5), or ``{}``.

    Reads the JSON file named by ``GEDIT_CONTEXT``. An empty dictionary means the script
    was started the v1 way (no header, no context), which every bundled script has to
    survive: fall back to sensible defaults rather than raising. A context file that is
    there but unreadable is reported on stderr and treated the same way, because a script
    that dies on a broken context file says nothing useful to the person running it.
    """
    path = os.environ.get(CONTEXT_ENV)
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as err:
        print("gedit_nc: cannot read %s (%s)" % (CONTEXT_ENV, err), file=sys.stderr)
        return {}
    return data if isinstance(data, dict) else {}


def read_input() -> List[str]:
    """stdin as a list of lines, split on ``"\\n"``, without the line endings.

    The text arrives LF-joined whatever the document's own line ending is; the app puts
    it back on save. A trailing newline therefore shows up as a final empty element, and
    it has to be preserved on the way out, or every run would eat the last line break.
    """
    stream = getattr(sys.stdin, "buffer", None)
    raw = stream.read() if stream is not None else sys.stdin.read().encode("utf-8")
    return raw.decode("utf-8").split("\n")


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

#: ``(?<`` that is not a lookbehind, i.e. the ECMAScript named group.
_NAMED_GROUP = "(?<"


def to_py_regex(pattern: str) -> str:
    """A profile pattern as Python ``re`` source.

    Profile patterns live in the common subset of ECMAScript and Python ``re``
    (plan AD-11), so the only rewrite left is the named group: ``(?<name>`` becomes
    ``(?P<name>``. A lookbehind (``(?<=``) and a negative lookbehind (``(?<!``) are
    **not** named groups and must survive untouched, and neither is a ``(?<`` that stands
    inside a character class or behind a backslash.

    Compile the result with ``re.ASCII`` — ``\\d`` must not match Eastern Arabic digits
    in a comment — and add ``re.IGNORECASE`` unless the profile sets
    ``syntax.caseSensitive``. :func:`compile_profile` does both.
    """
    if not isinstance(pattern, str) or _NAMED_GROUP not in pattern:
        return pattern
    out: List[str] = []
    i = 0
    length = len(pattern)
    in_class = False
    while i < length:
        char = pattern[i]
        if char == "\\":
            out.append(pattern[i : i + 2])
            i += 2
            continue
        if in_class:
            if char == "]":
                in_class = False
            out.append(char)
            i += 1
            continue
        if char == "[":
            in_class = True
            out.append(char)
            i += 1
            continue
        if pattern.startswith(_NAMED_GROUP, i) and pattern[i + 3 : i + 4] not in ("=", "!"):
            out.append("(?P<")
            i += 3
            continue
        out.append(char)
        i += 1
    return "".join(out)


def _compile_pattern(pattern: Any, path: str, flags: int) -> Any:
    """Compiles one pattern, or raises ``ValueError`` naming ``path``."""
    if not isinstance(pattern, str):
        raise ValueError("%s: a pattern is required" % path)
    try:
        return re.compile(to_py_regex(pattern), flags)
    except re.error as err:
        raise ValueError("%s: %s" % (path, err)) from err


def _compile_optional(pattern: Any, path: str, flags: int) -> Any:
    return None if pattern is None else _compile_pattern(pattern, path, flags)


def _compile_list(patterns: Any, path: str, flags: int) -> List[Any]:
    return [_compile_pattern(p, "%s[%d]" % (path, i), flags) for i, p in enumerate(patterns or [])]


def _compile_keywords(keywords: Any) -> List[str]:
    """Upper-cased, de-duplicated and longest first, so ``TOOL CALL`` beats ``TOOL``."""
    seen: List[str] = []
    known = set()
    for keyword in keywords or []:
        if isinstance(keyword, str) and keyword.strip() != "":
            upper = keyword.strip().upper()
            if upper not in known:
                known.add(upper)
                seen.append(upper)
    return sorted(seen, key=lambda word: (-len(word), word))


def _dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def compile_profile(profile: Dict[str, Any]) -> CompiledProfile:
    """Compiles every pattern of ``profile`` once.

    Raises ``ValueError`` when a pattern does not compile, naming the JSON path of the
    field (``outline[2].pattern``), so the message points at the profile and not at the
    script.
    """
    profile = _dict(profile)
    syntax = _dict(profile.get("syntax"))
    flags = re.ASCII if syntax.get("caseSensitive") is True else re.ASCII | re.IGNORECASE

    detect = _dict(profile.get("detect"))
    tool_call = _dict(profile.get("toolCall"))
    program = _dict(profile.get("program"))
    numbering = _dict(profile.get("numbering"))
    tool_list = _dict(profile.get("toolList"))

    detect_content: List[Tuple[Any, float]] = []
    for i, rule in enumerate(detect.get("content") or []):
        rule = _dict(rule)
        regex = _compile_pattern(rule.get("pattern"), "detect.content[%d].pattern" % i, flags)
        weight = rule.get("weight")
        detect_content.append((regex, weight if isinstance(weight, (int, float)) else 0))

    outline: List[Tuple[Any, Any]] = []
    for i, rule in enumerate(profile.get("outline") or []):
        rule = _dict(rule)
        outline.append((rule.get("kind"), _compile_pattern(rule.get("pattern"), "outline[%d].pattern" % i, flags)))

    references: List[Tuple[Any, List[str]]] = []
    for i, rule in enumerate(numbering.get("references") or []):
        rule = _dict(rule)
        trigger = _compile_pattern(rule.get("trigger"), "numbering.references[%d].trigger" % i, flags)
        references.append((trigger, [a for a in (rule.get("addresses") or []) if isinstance(a, str)]))

    patterns: Dict[str, Any] = {
        "detect_content": detect_content,
        "section_heading": _compile_optional(syntax.get("sectionHeading"), "syntax.sectionHeading", flags),
        "continuation": _compile_optional(syntax.get("continuation"), "syntax.continuation", flags),
        "variables": _compile_optional(syntax.get("variables"), "syntax.variables", flags),
        "tool_trigger": _compile_pattern(tool_call.get("trigger"), "toolCall.trigger", flags),
        "tool": _compile_pattern(tool_call.get("tool"), "toolCall.tool", flags),
        "program_start": _compile_list(program.get("start"), "program.start", flags),
        "program_end": _compile_list(program.get("end"), "program.end", flags),
        "outline": outline,
        "references": references,
        "comment_filter": _compile_optional(tool_list.get("commentFilter"), "toolList.commentFilter", flags),
    }

    return CompiledProfile(
        profile=profile,
        flags=flags,
        patterns=patterns,
        keywords=_compile_keywords(syntax.get("keywords")),
    )


#: A variable pattern whose first character is a literal, so it can lead the scan.
_LITERAL_LEAD = re.compile(r"^[^\\^$.|?*+()\[\]{}]")


def _build_spec(cp: CompiledProfile) -> _LexSpec:
    syntax = _dict(cp.profile.get("syntax"))
    case_sensitive = syntax.get("caseSensitive") is True

    comments: List[_CommentMarker] = []
    for raw in syntax.get("comments") or []:
        raw = _dict(raw)
        start = raw.get("start")
        if not isinstance(start, str) or start == "":
            continue
        end = raw.get("end")
        comments.append(
            _CommentMarker(
                start=start,
                end=end if isinstance(end, str) and end != "" else None,
                code=_to_upper(ord(start[0])),
            )
        )

    keywords: Dict[int, List[_KeywordEntry]] = {}
    for keyword in cp.keywords:
        parts = [part for part in re.split(r"\s+", keyword) if part != ""]
        if not parts:
            continue
        entry = _KeywordEntry(canonical=" ".join(parts), parts=parts, single=len(keyword) == 1)
        keywords.setdefault(_to_upper(ord(keyword[0])), []).append(entry)

    block_skip = _dict(syntax.get("blockSkip"))
    position = block_skip.get("position") or "either"
    chars = block_skip.get("chars")
    skip = (
        _Skip(
            codes=[ord(char) for char in chars],
            before=position in ("before-number", "either"),
            after=position in ("after-number", "either"),
            levels=block_skip.get("levels") is True,
        )
        if isinstance(chars, str) and chars != ""
        else None
    )

    comment_leads = set(marker.code for marker in comments)
    operators = set()
    for char in _OPERATOR_CHARS:
        code = ord(char)
        if any(
            ord(marker.start[0]) == code or (marker.end is not None and ord(marker.end[0]) == code)
            for marker in comments
        ):
            continue
        operators.add(code)

    variable_pattern = syntax.get("variables")
    lead = (
        ord(variable_pattern[0])
        if isinstance(variable_pattern, str) and variable_pattern != "" and _LITERAL_LEAD.match(variable_pattern)
        else _NO_CHAR
    )

    block_number = _dict(syntax.get("blockNumber"))
    prefixes = [
        value
        for value in [block_number.get("prefix")] + list(block_number.get("altPrefixes") or [])
        if isinstance(value, str) and value != ""
    ]

    incremental_prefix = syntax.get("incrementalPrefix")
    separator = syntax.get("decimalSeparator")
    skip_codes = set(skip.codes if skip is not None else [])

    return _LexSpec(
        packed=syntax.get("wordSeparatorRequired") is not True,
        case_sensitive=case_sensitive,
        comments=comments,
        strings=syntax.get("strings") is True,
        block_number_mode="leading-integer" if block_number.get("mode") == "leading-integer" else "prefix",
        block_number_prefixes=prefixes,
        skip=skip,
        keywords=keywords,
        variables=cp.patterns.get("variables"),
        variable_lead=lead,
        continuation=cp.patterns.get("continuation"),
        section_heading=cp.patterns.get("section_heading"),
        program_start=list(cp.patterns.get("program_start") or []),
        incremental=(
            _to_upper(ord(incremental_prefix))
            if isinstance(incremental_prefix, str) and len(incremental_prefix) == 1
            else _NO_CHAR
        ),
        decimal_point=ord(separator[0]) if isinstance(separator, str) and separator != "" else ord("."),
        operators=frozenset(operators),
        tape_marker=_PERCENT not in comment_leads and _PERCENT not in skip_codes,
        colon_program=block_number.get("mode") != "leading-integer" and _COLON not in comment_leads,
    )


def _lex_spec(cp: CompiledProfile) -> _LexSpec:
    """The scanner's view of ``cp``, built once and cached on it."""
    if cp.spec is None:
        cp.spec = _build_spec(cp)
    return cp.spec


# ---------------------------------------------------------------------------
# Tokenizing — mirrors src/lib/core/nc/tokenizer.ts
# ---------------------------------------------------------------------------


def _match_literal(line: str, p: int, literal: str, case_sensitive: bool) -> bool:
    """Compares ``literal`` against the line at ``p``, honouring the profile's case rule."""
    if p + len(literal) > len(line):
        return False
    for i, want in enumerate(literal):
        a = ord(line[p + i])
        b = ord(want)
        if a == b:
            continue
        if case_sensitive or _to_upper(a) != _to_upper(b):
            return False
    return True


def _comment_at(line: str, p: int, spec: _LexSpec) -> Optional[_CommentMarker]:
    """The comment marker that starts at ``p``, or ``None``."""
    code = _to_upper(_code_at(line, p))
    for marker in spec.comments:
        if marker.code != code:
            continue
        if _match_literal(line, p, marker.start, spec.case_sensitive):
            return marker
    return None


def _comment_end_at(line: str, p: int, limit: int, marker: _CommentMarker, spec: _LexSpec) -> int:
    """Where the comment that starts at ``p`` ends (exclusive).

    A comment with an end marker stops at the first one and runs to ``limit`` when it is
    missing, which is what an unclosed ``(`` does. A comment without an end marker runs to
    ``limit`` as well, but gives back its trailing whitespace, so a Klartext ``; TEXT ~``
    keeps the continuation marker outside the comment.
    """
    if marker.end is None:
        end = limit
        while end > p and _is_space(ord(line[end - 1])):
            end -= 1
        return end
    for i in range(p + len(marker.start), limit - len(marker.end) + 1):
        if _match_literal(line, i, marker.end, spec.case_sensitive):
            return i + len(marker.end)
    return limit


def _string_end_at(line: str, p: int, limit: int) -> int:
    """Where the string that starts at ``p`` ends (exclusive); an unclosed one runs to ``limit``."""
    for i in range(p + 1, limit):
        if ord(line[i]) == _QUOTE:
            return i + 1
    return limit


def _expression_end_at(line: str, p: int, limit: int) -> int:
    """Where the bracket expression that starts at ``p`` ends (exclusive); brackets may nest."""
    depth = 0
    for i in range(p, limit):
        code = ord(line[i])
        if code == _BRACKET_OPEN:
            depth += 1
        elif code == _BRACKET_CLOSE:
            depth -= 1
            if depth == 0:
                return i + 1
    return limit


def _number_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the number that starts at ``p``, or ``p`` when there is none (a sign is not one)."""
    i = p
    digits = False
    while i < limit and _is_digit(ord(line[i])):
        i += 1
        digits = True
    if i < limit and ord(line[i]) == spec.decimal_point:
        after_point = i + 1
        j = after_point
        while j < limit and _is_digit(ord(line[j])):
            j += 1
        if digits or j > after_point:
            digits = True
            i = j
    return i if digits else p


@dataclass
class _ValueRead:
    end: int
    text: str
    value: Optional[NumericLiteral]


def _read_value(line: str, p: int, limit: int, spec: _LexSpec, allow_lone_sign: bool) -> Optional[_ValueRead]:
    """Reads the value of a word at ``p``: a number, a variable or a bracket expression.

    Each may carry a sign. ``allow_lone_sign`` accepts a sign on its own, which is how
    Klartext writes a rotation direction (``DR-``).
    """
    if p >= limit:
        return None
    first = ord(line[p])
    signed = first == _PLUS or first == _MINUS
    start = p + 1 if signed else p

    number_end = _number_end_at(line, start, limit, spec)
    if number_end > start:
        text = line[p:number_end]
        return _ValueRead(end=number_end, text=text, value=parse_number(text))

    if spec.variables is not None and start < limit:
        match = spec.variables.match(line, start)
        if match is not None and start + len(match.group(0)) <= limit:
            end = start + len(match.group(0))
            return _ValueRead(end=end, text=line[p:end], value=None)

    if start < limit and ord(line[start]) == _BRACKET_OPEN:
        end = _expression_end_at(line, start, limit)
        return _ValueRead(end=end, text=line[p:end], value=None)

    if signed and allow_lone_sign:
        return _ValueRead(end=p + 1, text=line[p : p + 1], value=None)
    return None


def _chunk_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the whitespace-delimited chunk at ``p`` (a comment or ``"`` ends it too)."""
    i = p
    while i < limit:
        code = ord(line[i])
        if _is_space(code) or (spec.strings and code == _QUOTE):
            break
        if spec.comments and _comment_at(line, i, spec) is not None:
            break
        i += 1
    return i


@dataclass
class _BlockNumberScan:
    start: int
    end: int
    digits_start: int
    prefix: str


def _scan_block_number(line: str, p: int, limit: int, spec: _LexSpec) -> Optional[_BlockNumberScan]:
    """The block number at ``p``, when the profile's rule finds one there."""
    if spec.block_number_mode == "leading-integer":
        i = p
        while i < limit and _is_digit(ord(line[i])):
            i += 1
        if i == p:
            return None
        if i < limit:
            nxt = ord(line[i])
            # A leading integer is a block number only when the block starts after it.
            if not _is_space(nxt) and not (spec.skip is not None and spec.skip.after and nxt in spec.skip.codes):
                return None
        return _BlockNumberScan(start=p, end=i, digits_start=p, prefix="")

    for prefix in spec.block_number_prefixes:
        if not _match_literal(line, p, prefix, spec.case_sensitive):
            continue
        i = p + len(prefix)
        while i < limit and _is_space(ord(line[i])):
            i += 1
        digits_start = i
        while i < limit and _is_digit(ord(line[i])):
            i += 1
        if i == digits_start:
            continue
        return _BlockNumberScan(start=p, end=i, digits_start=digits_start, prefix=prefix)
    return None


def _scan_skip(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the block-skip mark at ``p``, or ``p`` when there is none."""
    skip = spec.skip
    if skip is None or p >= limit or ord(line[p]) not in skip.codes:
        return p
    end = p + 1
    if skip.levels and end < limit:
        level = ord(line[end])
        if _ZERO < level <= _NINE:
            end += 1
    return end


def _match_keyword(line: str, p: int, limit: int, spec: _LexSpec) -> Optional[Tuple[int, _KeywordEntry]]:
    """The keyword that starts at ``p``, with the position behind it."""
    group = spec.keywords.get(_to_upper(ord(line[p])))
    if not group:
        return None

    for entry in group:
        q = p
        ok = True
        for i, part in enumerate(entry.parts):
            if i > 0:
                after = q
                while after < limit and _is_space(ord(line[after])):
                    after += 1
                if after == q:
                    ok = False
                    break
                q = after
            if q + len(part) > limit or not _match_literal(line, q, part, spec.case_sensitive):
                ok = False
                break
            q += len(part)
        if not ok:
            continue

        # A packed dialect writes `GOTO100`, so only a letter behind the keyword rules it
        # out. Where words are separated, a one-letter keyword needs a separator, or the
        # Klartext C axis (`C+45`) and a tool length (`L+10`) would become path functions.
        if q < limit:
            nxt = ord(line[q])
            separated = (not spec.packed) and entry.single
            if (not _is_space(nxt)) if separated else _is_letter(nxt):
                continue
        return q, entry
    return None


def _match_program_marker(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """A program number or tape marker at the head of a line; returns its end, or ``p``."""
    code = ord(line[p])
    if spec.tape_marker and code == _PERCENT:
        return p + 1

    if spec.colon_program and code == _COLON:
        i = p + 1
        while i < limit and _is_digit(ord(line[i])):
            i += 1
        if i > p + 1:
            return i

    if _is_letter(code):
        for regex in spec.program_start:
            match = regex.search(line)
            if match is None or match.start() != 0:
                continue
            end = len(match.group(0))
            start = 0
            while start < end and _is_space(ord(line[start])):
                start += 1
            if start == p and p < end <= limit:
                return end
    return p


def _ends_operand(tokens: List[Token]) -> bool:
    """True when a ``+`` or ``-`` behind these tokens joins two operands instead of signing one."""
    i = len(tokens) - 1
    while i >= 0 and tokens[i].kind == "whitespace":
        i -= 1
    if i < 0:
        return False
    return tokens[i].kind in ("word", "variable", "expression", "string", "blockNumber")


def _push(tokens: List[Token], kind: str, line: str, start: int, end: int) -> Token:
    token = Token(kind=kind, start=start, end=end, text=line[start:end])
    tokens.append(token)
    return token


def _push_unknown(tokens: List[Token], line: str, start: int, end: int) -> None:
    """Adds an unknown token, merging it with the one before when they touch."""
    last = tokens[-1] if tokens else None
    if last is not None and last.kind == "unknown" and last.end == start:
        last.end = end
        last.text = line[last.start : end]
        return
    _push(tokens, "unknown", line, start, end)


def _push_space(tokens: List[Token], line: str, p: int, limit: int) -> int:
    end = p
    while end < limit and _is_space(ord(line[end])):
        end += 1
    if end > p:
        _push(tokens, "whitespace", line, p, end)
    return end


def _describe_word(token: Token, address: str, spec: _LexSpec, value: Optional[_ValueRead]) -> None:
    """Puts the address and the value on a word token.

    The incremental prefix is only taken off a coordinate word — one or two letters behind
    the prefix and a value behind those (``IX+10``, ``IPA+360``) — so a program name such
    as ``INCHJOB`` keeps all of its letters.
    """
    name = address if spec.case_sensitive else address.upper()
    if (
        spec.incremental != _NO_CHAR
        and value is not None
        and 2 <= len(name) <= 3
        and _to_upper(ord(name[0])) == spec.incremental
    ):
        name = name[1:]
        token.incremental = True
    token.address = name
    if value is not None:
        token.value_text = value.text
        token.value = value.value


def tokenize_line(
    line: str,
    cp: CompiledProfile,
    prev_state: Optional[LineState] = None,
) -> Tuple[List[Token], LineState]:
    """The tokens of one block, and the state for the line after it.

    The same algorithm as ``tokenizeLine`` in ``src/lib/core/nc/tokenizer.ts``, checked
    against the same goldens in ``tests/fixtures/tokens/``. Stateful only in the Klartext
    continuation bit, so any line can be tokenized on its own once the state of the line
    before it is known.

    **Every transform and every script works on these tokens, never on a raw-line
    regex.** That is what keeps a `G` inside a comment, a tool name inside a string and
    an address inside an expression from being rewritten.
    """
    spec = _lex_spec(cp)
    tokens: List[Token] = []

    # The continuation marker is found first: it is the line's tail, and a comment in
    # front of it must not swallow it.
    limit = len(line)
    continuation_start = -1
    if spec.continuation is not None:
        match = spec.continuation.search(line)
        if match is not None:
            continuation_start = match.start()
            limit = match.start()

    p = _push_space(tokens, line, 0, limit)
    # A line that continues the one above carries no block number and no program marker.
    at_head = not (prev_state is not None and prev_state.continuation is True)

    # `_chunk_end_at` scans forward to the end of the chunk, so asking it once per
    # character makes a long unbroken run quadratic. The chunk end only changes when `p`
    # leaves the chunk, and `p` never moves backwards, so one scan per chunk is enough.
    cached_chunk_end = [-1]

    def chunk_from(frm: int) -> int:
        if frm >= cached_chunk_end[0]:
            cached_chunk_end[0] = _chunk_end_at(line, frm, limit, spec)
        return cached_chunk_end[0]

    if at_head:
        if spec.skip is not None and spec.skip.before:
            end = _scan_skip(line, p, limit, spec)
            if end > p:
                _push(tokens, "skip", line, p, end)
                p = _push_space(tokens, line, end, limit)
        block = _scan_block_number(line, p, limit, spec)
        if block is not None:
            token = _push(tokens, "blockNumber", line, block.start, block.end)
            digits = line[block.digits_start : block.end]
            if block.prefix != "":
                token.address = block.prefix if spec.case_sensitive else block.prefix.upper()
            token.value_text = digits
            token.value = parse_number(digits)
            at_head = False
            p = _push_space(tokens, line, block.end, limit)
            if spec.skip is not None and spec.skip.after:
                end = _scan_skip(line, p, limit, spec)
                if end > p:
                    _push(tokens, "skip", line, p, end)
                    p = _push_space(tokens, line, end, limit)

    # A structure block (`12 * - ROUGHING`) is a heading; its text is read as a comment.
    if spec.section_heading is not None and p < limit and ord(line[p]) == _STAR and spec.section_heading.search(line):
        end = limit
        while end > p and _is_space(ord(line[end - 1])):
            end -= 1
        _push(tokens, "comment", line, p, end)
        p = end

    while p < limit:
        code = ord(line[p])
        if _is_space(code):
            p = _push_space(tokens, line, p, limit)
            continue
        head = at_head
        at_head = False

        marker = _comment_at(line, p, spec) if spec.comments else None
        if marker is not None:
            end = max(_comment_end_at(line, p, limit, marker, spec), p + 1)
            _push(tokens, "comment", line, p, end)
            p = end
            continue

        if spec.strings and code == _QUOTE:
            end = _string_end_at(line, p, limit)
            _push(tokens, "string", line, p, end)
            p = end
            continue

        keyword = _match_keyword(line, p, limit, spec)
        if keyword is not None:
            end, entry = keyword
            value: Optional[_ValueRead] = None
            if spec.packed:
                # `GOTO100`, `DO1`, `END1`: the jump target belongs to the keyword, which
                # is how `numbering.references` addresses it. A `[` starts an expression.
                q = end
                while q < limit and _is_space(ord(line[q])):
                    q += 1
                nxt = ord(line[q]) if q < limit else _NO_CHAR
                if nxt != _NO_CHAR and (
                    _is_digit(nxt) or nxt == spec.decimal_point or nxt == _PLUS or nxt == _MINUS
                ):
                    value = _read_value(line, q, limit, spec, False)
                    if value is not None:
                        end = value.end
            token = _push(tokens, "keyword", line, p, end)
            token.address = entry.canonical
            if value is not None:
                token.value_text = value.text
                token.value = value.value
            p = end
            continue

        if head:
            end = _match_program_marker(line, p, limit, spec)
            if end > p:
                token = _push(tokens, "programMarker", line, p, end)
                i = p
                while i < end and _is_letter(ord(line[i])):
                    i += 1
                if i == p:
                    i = p + 1  # `%`, `:`
                token.address = line[p:i] if spec.case_sensitive else line[p:i].upper()
                if i < end:
                    token.value_text = line[i:end]
                    token.value = parse_number(token.value_text)
                p = end
                continue

        if spec.variables is not None:
            match = spec.variables.match(line, p)
            if match is not None and p + len(match.group(0)) <= limit:
                p = _push(tokens, "variable", line, p, p + len(match.group(0))).end
                continue
        # The indirect form `#[#1+1]`: the lead character on its own, then the expression.
        if code == spec.variable_lead and p + 1 < limit and ord(line[p + 1]) == _BRACKET_OPEN:
            p = _push(tokens, "variable", line, p, p + 1).end
            continue

        if code == _BRACKET_OPEN:
            end = _expression_end_at(line, p, limit)
            _push(tokens, "expression", line, p, end)
            p = end
            continue

        if spec.packed:
            # One letter is the address; `,R` and `,C` take the comma with them.
            address_end = _NO_CHAR
            if _is_letter(code):
                address_end = p + 1
            elif code == _COMMA and p + 1 < limit and _is_letter(ord(line[p + 1])):
                address_end = p + 2
            if address_end != _NO_CHAR:
                q = address_end
                while q < limit and _is_space(ord(line[q])):
                    q += 1
                value = _read_value(line, q, limit, spec, False)
                token = _push(tokens, "word", line, p, value.end if value is not None else address_end)
                _describe_word(token, line[p:address_end], spec, value)
                p = token.end
                continue
        elif _is_letter(code):
            chunk_end = chunk_from(p)
            letters = p
            while letters < chunk_end and _is_letter(ord(line[letters])):
                letters += 1
            if letters == chunk_end:
                token = _push(tokens, "word", line, p, chunk_end)
                _describe_word(token, line[p:chunk_end], spec, None)
                p = chunk_end
                continue
            # The shortest address whose value fills the rest of the chunk wins, so `FQ50`
            # is the feed from Q50 while `DR-0.02` is a delta radius. Past the letters the
            # address may take digits with it, but only in front of a signed value, which
            # is what tells the delta radius of tool 2 (`DR2+0.05`) from a plain `DR2`.
            digits = letters
            while digits < chunk_end and _is_digit(ord(line[digits])):
                digits += 1
            found: Optional[_ValueRead] = None
            split = _NO_CHAR
            for s in range(p + 1, digits + 1):
                if s > letters:
                    sign = ord(line[s])
                    if sign != _PLUS and sign != _MINUS:
                        continue
                value = _read_value(line, s, chunk_end, spec, True)
                if value is not None and value.end == chunk_end:
                    found = value
                    split = s
                    break
            if found is not None:
                token = _push(tokens, "word", line, p, chunk_end)
                _describe_word(token, line[p:split], spec, found)
                p = chunk_end
                continue
            # Not a word at all: a program name, a path. One token, on to the next chunk.
            _push_unknown(tokens, line, p, chunk_end)
            p = chunk_end
            continue

        # A value without an address: a jump target, a label number, a right-hand side.
        if (
            _is_digit(code)
            or code == spec.decimal_point
            or ((code == _PLUS or code == _MINUS) and not _ends_operand(tokens))
        ):
            stop = limit if spec.packed else chunk_from(p)
            value = _read_value(line, p, stop, spec, False)
            if value is not None:
                token = _push(tokens, "word", line, p, value.end)
                token.value_text = value.text
                token.value = value.value
                p = value.end
                continue

        if code in spec.operators:
            p = _push(tokens, "operator", line, p, p + 1).end
            continue

        _push_unknown(tokens, line, p, p + 1)
        p += 1

    if continuation_start >= 0:
        end = len(line)
        while end > continuation_start and _is_space(ord(line[end - 1])):
            end -= 1
        _push(tokens, "continuation", line, continuation_start, end)
        _push_space(tokens, line, end, len(line))

    return tokens, LineState(continuation=continuation_start >= 0)


def block_number_of(line: str, cp: CompiledProfile) -> Optional[Dict[str, Any]]:
    """The block number of a line, or ``None``.

    ``{"value": int, "text": str, "start": int, "end": int}``. ``start`` and ``end`` cover
    the whole block number including its prefix, so a renumber can replace exactly that
    span, while ``text`` is the digits as they were written. Mirrors ``blockNumberOf``.
    """
    spec = _lex_spec(cp)
    limit = len(line)

    p = 0
    while p < limit and _is_space(ord(line[p])):
        p += 1
    if spec.skip is not None and spec.skip.before:
        end = _scan_skip(line, p, limit, spec)
        if end > p:
            p = end
            while p < limit and _is_space(ord(line[p])):
                p += 1

    block = _scan_block_number(line, p, limit, spec)
    if block is None:
        return None

    text = line[block.digits_start : block.end]
    return {"value": int(text, 10), "text": text, "start": block.start, "end": block.end}


def mask_comments(line: str, cp: CompiledProfile) -> str:
    """``line`` with every comment blanked out, same length. Mirrors ``maskComments``.

    Every code pattern of a profile (the tool call, the program start and end, the
    ``outline`` rules that are not ``comment`` or ``section``, the numbering triggers)
    runs against the masked line, so ``(T1 M6)`` inside a comment is never a tool change.
    The mask keeps the line's length and its offsets, so a match position on the masked
    line is a position in the real line. Strings stay as they are, because tool names are
    strings — and because a comment marker inside a string does not start a comment.
    """
    spec = _lex_spec(cp)

    limit = len(line)
    if spec.continuation is not None:
        match = spec.continuation.search(line)
        if match is not None:
            limit = match.start()

    masked = ""
    copied = 0
    p = 0

    if spec.section_heading is not None:
        star = line.find("*")
        if 0 <= star < limit and spec.section_heading.search(line):
            masked = line[:star] + " " * max(0, limit - star)
            copied = limit
            p = limit

    while p < limit:
        code = ord(line[p])
        # Only in a dialect that has strings. Fanuc has none, so a stray `"` there is just
        # a character, and reading it as a string opener would stop the mask at that point.
        if spec.strings and code == _QUOTE:
            # A string is code, not text: skip it whole so it cannot open a comment.
            end = p + 1
            while end < limit and ord(line[end]) != _QUOTE:
                end += 1
            p = end + 1 if end < limit else limit
            continue
        marker = _comment_at(line, p, spec) if spec.comments else None
        if marker is None:
            p += 1
            continue
        end = max(_comment_end_at(line, p, limit, marker, spec), p + 1)
        masked += line[copied:p] + " " * (end - p)
        copied = end
        p = end

    if copied == 0:
        return line
    return masked + line[copied:]


# ---------------------------------------------------------------------------
# Numbers — mirrors src/lib/core/nc/{numbers,numberFormat}.ts
# ---------------------------------------------------------------------------

_POINT = 0x2E


def parse_number(raw: str) -> Optional[NumericLiteral]:
    """``raw`` split into sign, integer part and fraction, or ``None`` when it is not a number.

    Mirrors ``parseNumber``: no exponent, no thousands separator, and ``10.`` and ``.5``
    are both valid NC numbers. The whole string has to be the number — a leading or
    trailing space, a second point, a unit or a stray letter all give ``None``. ``'10.'``
    keeps its empty fraction (``frac_part`` is ``''``, not ``None``), because the point is
    what makes it a millimetre value on a Fanuc control.

    The accepted grammar is ``[+-] ( digits [ '.' [digits] ] | '.' digits )``. The
    separator is the point even for a profile that writes a comma: the tokenizer scans the
    value with the profile's separator and hands the text over.
    """
    if not isinstance(raw, str) or raw == "":
        return None

    i = 0
    sign = ""
    first = ord(raw[0])
    if first == _PLUS or first == _MINUS:
        sign = "+" if first == _PLUS else "-"
        i = 1

    int_start = i
    while i < len(raw) and _is_digit(ord(raw[i])):
        i += 1
    int_part = raw[int_start:i]

    frac_part: Optional[str] = None
    has_point = False
    if i < len(raw) and ord(raw[i]) == _POINT:
        has_point = True
        i += 1
        frac_start = i
        while i < len(raw) and _is_digit(ord(raw[i])):
            i += 1
        frac_part = raw[frac_start:i]

    if i != len(raw):
        return None  # trailing text: '10mm', '1.2.3', '10 '
    if int_part == "" and (frac_part is None or frac_part == ""):
        return None  # '', '+', '.', '-.'

    return NumericLiteral(raw=raw, sign=sign, int_part=int_part, frac_part=frac_part, has_point=has_point)


def _increment(digits: str) -> str:
    """Adds one to a string of digits, carrying to the left: ``'199'`` → ``'200'``."""
    out = list(digits)
    for i in range(len(out) - 1, -1, -1):
        if out[i] == "9":
            out[i] = "0"
            continue
        out[i] = chr(ord(out[i]) + 1)
        return "".join(out)
    return "1" + "".join(out)


def _round_digits(int_part: str, frac_part: str, decimals: int) -> Tuple[str, str]:
    """Rounds ``int_part.frac_part`` to ``decimals`` places, half away from zero."""
    if len(frac_part) <= decimals:
        return int_part, frac_part.ljust(decimals, "0")

    head = ("0" if int_part == "" else int_part) + frac_part[:decimals]
    digits = _increment(head) if (ord(frac_part[decimals]) - 0x30) >= 5 else head
    cut = len(digits) - decimals
    return digits[:cut], digits[cut:]


def _is_zero(digits: str) -> bool:
    return all(char == "0" for char in digits)


_LEADING_ZEROS = re.compile(r"^0+(?=\d)", re.ASCII)

#: What a profile without a ``numberFormat`` gets: the format that changes nothing.
_DEFAULT_NUMBER_FORMAT: Dict[str, Any] = {
    "decimals": "keep",
    "trailingZeros": "keep",
    "keepPoint": True,
    "plusSign": "keep",
}


def number_format_of(profile: Dict[str, Any]) -> Dict[str, Any]:
    """The profile's ``numberFormat``, with the missing fields defaulted.

    The default is the identity format (``decimals: 'keep'``, ``trailingZeros: 'keep'``,
    ``keepPoint: true``, ``plusSign: 'keep'``): a value that is not touched by the
    arithmetic comes back written exactly as it stood in the file.
    """
    fmt = dict(_DEFAULT_NUMBER_FORMAT)
    fmt.update({k: v for k, v in _dict(_dict(profile).get("numberFormat")).items() if v is not None})
    return fmt


def format_number(
    decimal: str,
    original: Optional[NumericLiteral],
    fmt: Dict[str, Any],
    decimal_point_significant: bool = True,
) -> str:
    """An exact decimal string written the way the profile asks for.

    ``fmt`` is the profile's ``numberFormat``: ``decimals`` (``'keep'`` or a count),
    ``trailingZeros`` (``'keep'`` or ``'drop'``), ``keepPoint`` and ``plusSign``
    (``'keep'``, ``'always'`` or ``'never'``). ``original`` is the literal that stood in
    the file, so ``'keep'`` can mean "the precision it was written with".

    With ``decimal_point_significant`` (Fanuc's ``syntax.decimalPointSignificant``) the
    point follows the original: a value written without one never gains one and a value
    written with one never loses it, whatever ``keepPoint`` says — except when the
    fraction is not empty, which needs the point to be readable at all.

    Two further rules keep a reformat that changes nothing a no-op: leading zeros in the
    integer part are dropped (``007`` → ``7``), but a value the file wrote without its
    leading zero (``F.15``) keeps that style while the result stays below one.

    Rounding is half away from zero. Same digits as ``formatNumber`` in
    ``src/lib/core/nc/numberFormat.ts``, checked against
    ``tests/fixtures/numberformat.cases.json``.

    Raises ``ValueError`` when ``decimal`` is not a decimal number.
    """
    parsed = parse_number(decimal.strip() if isinstance(decimal, str) else "")
    if parsed is None:
        raise ValueError("format_number: not a decimal number: %r" % (decimal,))

    fmt = _dict(fmt)
    written = len(original.frac_part or "") if original is not None else len(parsed.frac_part or "")
    wanted = fmt.get("decimals", "keep")
    decimals = written if wanted == "keep" else max(0, int(wanted))

    int_part, fraction = _round_digits(parsed.int_part, parsed.frac_part or "", decimals)
    if fmt.get("trailingZeros") == "drop":
        fraction = fraction.rstrip("0")

    # The point: needed by a fraction, otherwise the profile and the written form decide.
    had_point = original.has_point if original is not None else parsed.has_point
    if decimal_point_significant and original is not None:
        wants_point = original.has_point
    else:
        wants_point = fmt.get("keepPoint") is True and had_point
    point = len(fraction) > 0 or wants_point

    integer = _LEADING_ZEROS.sub("", int_part)
    # `F.15` was written without its leading zero; keep that as long as it stays below one.
    if original is not None and original.int_part == "" and integer in ("", "0"):
        integer = ""
    elif integer == "":
        integer = "0"
    if integer == "" and fraction == "":
        integer = "0"

    negative = parsed.sign == "-" and not (_is_zero(integer) and _is_zero(fraction))
    sign = ""
    plus = fmt.get("plusSign")
    if negative:
        sign = "-"
    elif plus == "always":
        sign = "+"
    elif plus == "keep" and (original.sign if original is not None else parsed.sign) == "+":
        sign = "+"

    return "%s%s%s%s" % (sign, integer, "." if point else "", fraction)


def scale_decimal(raw: str, percent: str) -> str:
    """``raw`` multiplied by ``percent`` percent, as an exact decimal string.

    ``decimal.Decimal`` arithmetic with enough precision that nothing is lost; the
    rounding to a written form is :func:`format_number`'s job, not this one's. The result
    never uses exponent notation, so it always parses back through :func:`parse_number`,
    and it carries no trailing zeros the arithmetic did not produce — the scale of the
    result is not a precision, and reading it as one is what `format_number`'s ``original``
    is there to prevent.

    Raises ``ValueError`` when either argument is not a decimal number.
    """
    left = parse_number(raw.strip() if isinstance(raw, str) else "")
    right = parse_number(str(percent).strip())
    if left is None:
        raise ValueError("scale_decimal: not a decimal number: %r" % (raw,))
    if right is None:
        raise ValueError("scale_decimal: not a percentage: %r" % (percent,))

    with localcontext() as context:
        # Enough digits that the product is exact: the two operands' digits plus the two
        # the division by a hundred shifts, and a wide margin on top.
        context.prec = len(left.raw) + len(right.raw) + 20
        product = Decimal(left.raw) * Decimal(right.raw)
        scaled = product.scaleb(-2)
    text = format(scaled, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


# ---------------------------------------------------------------------------
# Codes and modal state
# ---------------------------------------------------------------------------

_CODE_SPACE = re.compile(r"\s+", re.ASCII)
_CODE_JOIN = re.compile(r"^([A-Z]) (?=[-+.]?\d)", re.ASCII)
_CODE_PAD = re.compile(r"^([A-Z]+)0+(?=\d)", re.ASCII)


def normalize_code(code: str) -> str:
    """The canonical form of a written code: ``G01`` → ``G1``, ``cycl  def 200`` → ``CYCL DEF 200``.

    Mirrors ``normalizeCode`` in ``src/lib/core/codes/lookup.ts``: case is ignored, zero
    padding is dropped, a decimal part is kept (``G54.1``), whitespace inside a multi-word
    code collapses to one space, and a single address letter written apart from its digits
    joins up (``G 83`` → ``G83``, while ``CALL LBL`` keeps its space).
    """
    packed = _CODE_SPACE.sub(" ", code.upper().strip())
    return _CODE_PAD.sub(r"\1", _CODE_JOIN.sub(r"\1", packed))


#: The feed modes plan section 7.10 names. Which code is which comes from the database.
_FEED_MODE_CODES = ("G93", "G94", "G95")
#: Constant surface speed on and off.
_CSS_ON = "G96"
_CSS_OFF = "G97"
#: Klartext's feed per revolution and feed per tooth, which are addresses, not codes.
_KLARTEXT_FEED_MODES = ("FU", "FZ")
#: The address a plain feed is written with; it ends a Klartext ``FU`` / ``FZ`` mode.
_FEED_ADDRESS = "F"


class FeedModeTracker:
    """Which feed and speed modes are active, block by block.

    Feed a line's tokens to :meth:`update` in program order and read the attributes
    afterwards. What it tracks:

    * ``feed_mode`` — ``'G94'`` (units per minute, the default), ``'G95'`` (per
      revolution), ``'G93'`` (inverse time), or Klartext's ``'FU'`` / ``'FZ'``. A plain
      ``F`` word ends an ``FU`` / ``FZ`` mode and leaves an ISO mode alone.
    * ``css`` — ``True`` between ``G96`` and ``G97``: ``S`` is a surface speed, not rpm.
    * ``active_cycle`` — the cycle code that is modally active, or ``None``.
    * ``pitch_feed`` — ``True`` while the active cycle's code database entry says the
      ``F`` word is a thread pitch (tapping, ``G84``). Scaling such an ``F`` would change
      the thread, so scale-feed skips these blocks and reports them.
    * ``pitch_feed_ambiguous`` — ``True`` while a code is in force whose database entry
      says the same number is a **threading cycle in another G-code system** of this
      dialect (``pitchFeedAmbiguous``: Fanuc ``G76`` and ``G92``). The ``F`` of such a
      block is a boring feed on a mill and a thread lead on a lathe, and nothing in the
      block says which — so a scaling script refuses it and says why. ``ambiguous_code``
      names the code that raised it.

    The cycle codes come from the context's ``codes`` list, so this is profile driven
    and not a hardcoded Fanuc table. The rules it reads out of the database are:

    * a ``cycle`` entry that declares parameters, ``pitchFeed`` or ``pitchFeedAmbiguous``
      **starts** a cycle;
    * a ``cycle`` entry that declares none of them (Fanuc ``G80``, Klartext ``CYCL CALL``)
      **cancels** it;
    * a ``motion`` entry cancels it as well — that is what Fanuc's G80 means by "any code
      from the motion group cancels it" — unless the motion code carries a ``pitchFeed``
      of its own (``G32``, ``G33``), which makes it the active thread-cutting block;
    * a ``pitchFeedAmbiguous`` entry in any other group (Fanuc ``G92``) raises the
      ambiguity for **its own block only**, because such a code is not modal.

    A code the database does not know changes nothing, so an unknown dialect degrades to
    "no cycle is active" rather than to a wrong answer.
    """

    feed_mode: str
    css: bool
    active_cycle: Optional[str]
    pitch_feed: bool
    pitch_feed_ambiguous: bool
    ambiguous_code: Optional[str]

    def __init__(self, codes: Optional[Sequence[Dict[str, Any]]] = None) -> None:
        """``codes`` is the context's code database (``CodeEntry`` dictionaries)."""
        self._entries: Dict[str, Dict[str, Any]] = {}
        for entry in codes or []:
            if not isinstance(entry, dict):
                continue
            code = entry.get("code")
            if not isinstance(code, str) or code == "":
                continue
            self._entries.setdefault(normalize_code(code), entry)
            for alias in entry.get("aliases") or []:
                if isinstance(alias, str) and alias != "":
                    self._entries.setdefault(normalize_code(alias), entry)
        self.reset()

    def reset(self) -> None:
        """Back to the state at the top of a program."""
        self.feed_mode = "G94"
        self.css = False
        self.active_cycle = None
        self.pitch_feed = False
        self.pitch_feed_ambiguous = False
        self.ambiguous_code = None
        #: Raised by a modal cycle, and in force until the cycle is cancelled.
        self._modal_ambiguous: Optional[str] = None
        #: Raised by a non-modal code (``G92``), and in force for its own block only.
        self._block_ambiguous: Optional[str] = None

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry for a written code, following aliases, or ``None``."""
        return self._entries.get(normalize_code(code)) if code else None

    def update(self, tokens: Sequence[Token]) -> None:
        """Applies one block's tokens. Call it for every line, in order."""
        # A non-modal ambiguity belongs to the block that wrote it and to no other.
        self._block_ambiguous = None
        count = len(tokens)
        for i, token in enumerate(tokens):
            if token.kind == "word":
                address = token.address or ""
                if address in _KLARTEXT_FEED_MODES:
                    self.feed_mode = address
                    continue
                if address == _FEED_ADDRESS and self.feed_mode in _KLARTEXT_FEED_MODES:
                    self.feed_mode = "G94"
                if address != "":
                    self._apply(address + (token.value_text or ""))
            elif token.kind == "keyword":
                name = token.address or token.text
                # A multi-word code carries its number in the next token (`CYCL DEF 207`);
                # a packed dialect already has it on the keyword itself (`GOTO100`).
                number = token.value_text
                if number is None:
                    nxt = _next_code_token(tokens, i + 1, count)
                    if nxt is not None and nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                if number is not None and self.entry("%s %s" % (name, number)) is not None:
                    self._apply("%s %s" % (name, number))
                else:
                    self._apply(name)
        # The block's own code names itself; a modal cycle names itself only while no
        # code in this block already did.
        self.ambiguous_code = self._block_ambiguous or self._modal_ambiguous
        self.pitch_feed_ambiguous = self.ambiguous_code is not None

    def _apply(self, code: str) -> None:
        key = normalize_code(code)
        entry = self._entries.get(key)
        group = entry.get("group") if entry is not None else None

        if key in _FEED_MODE_CODES and group in (None, "feedmode"):
            self.feed_mode = key
            return
        if key in (_CSS_ON, _CSS_OFF) and group in (None, "spindlemode"):
            self.css = key == _CSS_ON
            return
        if entry is None:
            return

        ambiguous = entry.get("pitchFeedAmbiguous") is True
        if group == "cycle":
            if entry.get("pitchFeed") is True or ambiguous or entry.get("params"):
                self.active_cycle = key
                self.pitch_feed = entry.get("pitchFeed") is True
                self._modal_ambiguous = key if ambiguous else None
            else:
                self.active_cycle = None
                self.pitch_feed = False
                self._modal_ambiguous = None
        elif group == "motion":
            if entry.get("pitchFeed") is True or ambiguous:
                self.active_cycle = key
                self.pitch_feed = entry.get("pitchFeed") is True
                self._modal_ambiguous = key if ambiguous else None
            else:
                self.active_cycle = None
                self.pitch_feed = False
                self._modal_ambiguous = None
        elif ambiguous:
            # A code that is not a cycle and not a move (Fanuc `G92`): its meaning, and
            # with it the meaning of the block's `F`, belongs to this block alone.
            self._block_ambiguous = key


def _next_code_token(tokens: Sequence[Token], start: int, count: int) -> Optional[Token]:
    """The next token that is not whitespace, or ``None``."""
    for i in range(start, count):
        if tokens[i].kind != "whitespace":
            return tokens[i]
    return None


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _write_json(payload: Dict[str, Any]) -> None:
    """The result, on stdout, as compact UTF-8 JSON."""
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def report(
    title: str,
    columns: Sequence[Dict[str, str]],
    rows: Sequence[Dict[str, Any]],
    message: Optional[str] = None,
    findings: Optional[Sequence[Dict[str, Any]]] = None,
) -> None:
    """Writes a ``report`` result to stdout (``output = "report"``).

    ``columns`` are ``{"key": ..., "label": ...}`` in display order, ``rows`` are
    dictionaries keyed by those ``key`` values. A row or finding that carries ``line``
    (and optionally ``document``) is clickable in the results panel. ``findings`` are
    ``{"line": int, "message": str, "severity": "info" | "warning" | "error"}``.
    """
    payload: Dict[str, Any] = {
        "title": title,
        "columns": [dict(column) for column in columns],
        "rows": [dict(row) for row in rows],
    }
    if message is not None:
        payload["message"] = message
    if findings is not None:
        payload["findings"] = [dict(finding) for finding in findings]
    _write_json(payload)


def envelope(
    text: str,
    message: Optional[str] = None,
    findings: Optional[Sequence[Dict[str, Any]]] = None,
) -> None:
    """Writes an ``envelope`` result to stdout (``envelope = true`` in the header).

    ``{"text": ..., "message": ..., "findings": [...]}``, so a script can hand back new
    text together with a summary and warnings. ``text`` is used exactly as given: it
    keeps the trailing newline of the input when the input had one.
    """
    payload: Dict[str, Any] = {"text": text}
    if message is not None:
        payload["message"] = message
    if findings is not None:
        payload["findings"] = [dict(finding) for finding in findings]
    _write_json(payload)
