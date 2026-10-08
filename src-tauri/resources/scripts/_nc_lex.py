"""The lexer half of :mod:`gedit_nc`: profiles, tokens and numbers.

Split out of ``gedit_nc.py`` by the M6 prelude (P6) with **no behaviour change**: the
module grew past 1,700 lines, and M6 adds a modal interpreter and the machine number
rules on top of it. ``gedit_nc`` re-exports every public name below, so the import path a
script writes (``import gedit_nc``) and everything it may call are unchanged — this file
is an implementation detail and a script must not import it directly.

What lives here: the token model, the compiled profile, the tokenizer, comment masking,
block numbers, and decimal-string number parsing and formatting. In other words,
everything that answers "what does this line *say*" — never "what does it *mean*", which
is :mod:`_nc_modal`, and never "how does this control read it", which is
:mod:`_nc_machine`.

The rules of ``gedit_nc`` apply unchanged: standard library only, Python 3.9 syntax,
numbers as decimal strings (never floats), and every pattern inside the ECMAScript ∩
Python subset (plan AD-11).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from decimal import Decimal, localcontext
from functools import lru_cache
from typing import Any, Dict, List, Optional, Sequence, Tuple

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
    ``programMarker``, ``label``, ``call``, ``whitespace``, ``unknown``. ``start`` and
    ``end`` are offsets into the line, ``start`` inclusive and ``end`` exclusive.

    The two kinds M8 added (plan §7.5):

    ``label``
        a jump target the program names instead of numbering it: an Okuma sequence name
        (``NLAP1``, ``address`` ``'LAP1'``) or a Sinumerik label definition (``LOOP_A:``,
        ``address`` ``'LOOP_A'``). It is never a ``blockNumber``, so a renumber leaves it
        alone.
    ``call``
        an identifier written in front of ``(`` (a name of ``syntax.names`` also with
        blanks between the two), together with everything up to the matching ``)``:
        ``CYCLE83(50,0,2,-25,,-5)``, ``MSG ("A;B")``, ``L10(1)``. ``address`` is the
        identifier and ``value_text`` the argument text; the arguments are not tokenized.

    An address that takes ``=`` and an expression (``SB=1200``, ``S3=2500``, ``F=R10``)
    stays a ``word``: ``address`` is what stands in front of the ``=``, ``value_text``
    the right-hand side, and ``value`` is ``None`` unless that is one plain number — so
    nothing that computes with NC numbers can scale ``F=R10``. A name the program gives
    itself (``XNOW``, ``LAST_CUT``, ``DIA1``) is one ``unknown`` token with no address.

    ``index`` (M9, plan section 7.5, ``syntax.assignmentIndex``) is the bracket index of an
    assignment word without the brackets: ``'2'`` for ``LIMS[2]=1800``, ``'SPI'`` for
    ``S[SPI]=300``. ``address`` stays the identifier (``LIMS``, ``S``), so it is still a
    name the code database knows; ``index`` says which spindle. ``None`` on every other
    token.
    """

    kind: str
    start: int
    end: int
    text: str
    address: Optional[str] = None
    value_text: Optional[str] = None
    value: Optional[NumericLiteral] = None
    incremental: bool = False
    index: Optional[str] = None


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
_PAREN_OPEN = 0x28
_PAREN_CLOSE = 0x29
_PLUS = 0x2B
_COMMA = 0x2C
_MINUS = 0x2D
_ZERO = 0x30
_NINE = 0x39
_COLON = 0x3A
_EQUALS = 0x3D
_STAR = 0x2A
_BRACKET_OPEN = 0x5B
_BRACKET_CLOSE = 0x5D
_UNDERSCORE = 0x5F
_NO_CHAR = -1

#: The longest identifier an indexed assignment (``LIMS[2]=``) may have.
_MAX_INDEXED_NAME = 64

#: Operators, minus whatever the profile uses to delimit a comment. ``;`` is the
#: end-of-block character of the ISO tape format (syntax-fanuc section 2.2), which a post
#: may write at the end of every block; where ``;`` starts a comment (Klartext, Sinumerik)
#: it is not an operator.
_OPERATOR_CHARS = "=+-*/^%:<>|&,()!;"


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
    #: The prefixes a block number may start with: the above, then ``blockNumber.mainPrefix``.
    block_number_starts: List[str]
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
    #: ``syntax.decimalSeparatorAlt`` (the Klartext decimal comma, §7.16 / R4), or
    #: ``_NO_CHAR`` when the profile does not declare one.
    decimal_point_alt: int
    operators: frozenset
    #: ``%`` at the head of a line is a tape marker unless the profile uses it otherwise.
    tape_marker: bool
    #: ``:1234`` as a program number, the punched-tape form of ``O1234``.
    colon_program: bool
    #: P8 ``syntax.sequenceNames``: the block-number prefix also names blocks (``NLAP1``).
    sequence_names: bool
    #: P8 ``syntax.labels``: a label definition at the head of a block, group ``name``.
    labels: Optional[Any]
    #: P8 ``syntax.header``: a file header at the head of a line.
    header: Optional[Any]
    #: P8 ``syntax.systemVariables``, tried at a position like ``variables``.
    system_variables: Optional[Any]
    #: P8 ``syntax.assignment``: the address in front of an ``=``.
    assignment: Optional[Any]
    #: P8 ``syntax.calls``: an identifier in front of ``(`` is one token (``_argument_list_at``).
    calls: bool
    #: P9 ``syntax.assignmentIndex``: ``LIMS[2]=1800`` is one assignment word with an ``index``.
    assignment_index: bool
    #: P9 ``syntax.exponentMarker`` (upper case unless the profile is case sensitive), or ``""``.
    exponent: str
    #: M8 integration ``syntax.names``: a name the program gives itself is one token.
    names: Optional[Any]
    #: ``syntax.symbolAddresses`` (M9-2): marks that address the value packed behind them
    #: (Klartext ``#``), as character codes.
    symbol_addresses: frozenset
    #: Phase 2 ``syntax.programNames``: a program name (``<SHAFT_T12>``) is one token.
    program_names: Optional[Any]
    #: The literal first character of ``syntax.programNames`` (``<``), so it is tried only there.
    program_name_lead: int
    #: ``mask_comments``'s whole-line fast path: a compiled character class of every
    #: character that can start a span the mask changes (a comment marker, ``"`` when the
    #: profile has strings, the program-name lead). ``None`` when ``program_names`` cannot
    #: be reduced to a literal lead character (a regex marker) — the fast path is unsafe
    #: there, so ``mask_comments`` always takes the character loop for that profile.
    #: Mirrors ``LexSpec.maskLeadPattern`` (``tokenizer.ts``).
    mask_lead_pattern: Optional[Any]
    #: M12.5 ``syntax.freeText``: patterns with the group ``text``, tried where the block starts.
    free_text: List[Any] = field(default_factory=list)
    #: M12.5 ``syntax.colonWords`` as written (upper case unless case sensitive), longest first.
    colon_words: List[str] = field(default_factory=list)
    #: M12.5 ``syntax.callTargets``: the canonical keywords, and the name pattern.
    call_after: frozenset = frozenset()
    call_pattern: Optional[Any] = None
    #: M12.5 ``syntax.labelAfter`` and ``syntax.declareAfter``, as canonical keywords.
    label_after: frozenset = frozenset()
    declare_after: frozenset = frozenset()
    #: M12.5 ``syntax.plainTextRun``; 0 when the profile does not set it.
    plain_text_run: int = 0


@dataclass
class CompiledProfile:
    """A profile with its patterns compiled once. Mirrors TypeScript's ``CompiledProfile``.

    ``profile`` is the raw dictionary out of the context, ``flags`` are the ``re`` flags
    every pattern was compiled with (``re.ASCII``, plus ``re.IGNORECASE`` unless
    ``syntax.caseSensitive`` is set), ``patterns`` holds the compiled expressions under
    the same names the TypeScript side uses and ``keywords`` is ``syntax.keywords``
    upper-cased and sorted longest first, so a greedy match finds ``LBL`` before ``L``.

    ``patterns`` in full:

    ========================  =====================================================
    ``detect_content``        ``[(regex, weight), …]``
    ``detect_vetoes``         ``[regex, …]``: ``detect.vetoes`` (M9), compiled so a bad
                              one is reported here too; no script detects a profile
    ``section_heading``       regex or ``None``
    ``continuation``          regex or ``None``
    ``continuation_start``    regex or ``None`` (M8): the leading marker of a line that
                              belongs to the block above it (Okuma ``$``)
    ``variables``             regex or ``None``
    ``assignment``            regex or ``None`` (P8): the address in front of an ``=``
    ``labels``                regex or ``None`` (P8), with the named group ``name``
    ``system_variables``      regex or ``None`` (P8)
    ``header``                regex or ``None`` (P8): a file header at the head of a line
    ``names``                 regex or ``None`` (M8): a name the program gives itself
    ``program_names``         regex or ``None`` (phase 2): a program name in place of a
                              program number (Fanuc ``<SHAFT_T12>``)
    ``tool_trigger``          regex
    ``tool_ignore``           regex or ``None``: a trigger line that also matches is no tool call
    ``tool``                  regex, with the named group ``tool``
    ``program_start``         ``[regex, …]``
    ``program_end``           ``[regex, …]``
    ``outline``               ``[(kind, regex), …]``, in order; the first match wins
    ``references``            ``[(trigger_regex, [address, …]), …]``
    ``comment_filter``        regex or ``None``
    ========================  =====================================================

    ``spec`` is the scanner's derived view, built on first use and cached here.
    """

    profile: Dict[str, Any]
    flags: int = 0
    patterns: Dict[str, Any] = field(default_factory=dict)
    keywords: List[str] = field(default_factory=list)
    spec: Optional[_LexSpec] = None


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

#: ``(?<`` that is not a lookbehind, i.e. the ECMAScript named group.
_NAMED_GROUP = "(?<"

#: What ECMAScript's ``\s`` matches, as the body of a Python character class: its white
#: space and line terminators, the no-break space and the Unicode spaces included. Under
#: ``re.ASCII`` Python's own ``\s`` knows only the first six of them.
_JS_SPACE = "\\t\\n\\x0b\\x0c\\r \\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

#: What ECMAScript's ``.`` matches: anything but a line terminator.
_JS_DOT = "[^\\n\\r\\u2028\\u2029]"


def _class_end(pattern: str, start: int) -> int:
    """Index of the ``]`` that closes the character class opening at ``start``, or -1.

    As in ECMAScript, the first ``]`` that is not escaped closes it.
    """
    i = start + 1
    while i < len(pattern):
        if pattern[i] == "\\":
            i += 2
            continue
        if pattern[i] == "]":
            return i
        i += 1
    return -1


def _py_class(body: str) -> str:
    """The ECMAScript character class ``[body]`` as Python ``re`` source.

    Only ``\\s`` and ``\\S`` need a rewrite in there. ``\\s`` becomes the characters it
    stands for. For ``\\S`` a class body has no way to say "none of those" beside other
    members, so a class that holds it becomes an alternative: ``[\\S,]`` is "not a space,
    or a comma", ``[^\\S,]`` "a space that is not a comma". A ``-`` beside either escape
    is a character of its own in ECMAScript, because a class escape cannot end a range, so
    it is escaped here and Python reads no range into it either.
    """
    negated = body.startswith("^")
    if negated:
        body = body[1:]
    items: List[str] = []
    i = 0
    while i < len(body):
        step = 2 if body[i] == "\\" else 1
        items.append(body[i : i + step])
        i += step
    spaces = ("\\s", "\\S")
    if not any(item in spaces for item in items):
        return "[%s%s]" % ("^" if negated else "", body)
    rest: List[str] = []
    for k, item in enumerate(items):
        if item == "\\s":
            rest.append(_JS_SPACE)
        elif item == "\\S":
            continue
        elif item == "-" and (
            (k > 0 and items[k - 1] in spaces) or (k + 1 < len(items) and items[k + 1] in spaces)
        ):
            rest.append("\\-")
        else:
            rest.append(item)
    others = "".join(rest)
    if "\\S" not in items:
        return "[%s%s]" % ("^" if negated else "", others)
    if others.startswith("^"):
        others = "\\" + others
    if negated:
        return "(?:(?![%s])[%s])" % (others, _JS_SPACE) if others else "[%s]" % _JS_SPACE
    return "(?:[^%s]|[%s])" % (_JS_SPACE, others) if others else "[^%s]" % _JS_SPACE


def to_py_regex(pattern: str) -> str:
    """A profile pattern as Python ``re`` source.

    Profile patterns live in the common subset of ECMAScript and Python ``re``
    (plan AD-11). What is left to rewrite are the spellings the two read differently:

    - the named group: ``(?<name>`` becomes ``(?P<name>``. A lookbehind (``(?<=``) and a
      negative lookbehind (``(?<!``) are **not** named groups and survive untouched, and
      neither is a ``(?<`` inside a character class or behind a backslash.
    - ``\\s`` and ``\\S``, inside a character class and outside one. ECMAScript's ``\\s``
      also matches the no-break space and the other Unicode spaces (U+1680,
      U+2000–U+200A, U+202F, U+205F, U+3000, U+FEFF) and the line terminators U+2028 and
      U+2029; under ``re.ASCII`` Python's matches none of them. They become the class of
      exactly the characters ECMAScript means.
    - ``.``, which in ECMAScript stops at ``\\r``, U+2028 and U+2029 as well as at
      ``\\n``.

    Those two used to be left alone as harmless, but they are not: with an assignment
    rule, ``S3<NBSP>=2500`` was another spindle's speed to the editor and the main
    spindle's ``S3`` to a script, which then scaled the spindle number. Every other
    escape reads the same on both sides once ``re.ASCII`` is set.

    Compile the result with ``re.ASCII`` — ``\\d`` must not match Eastern Arabic digits
    in a comment — and add ``re.IGNORECASE`` unless the profile sets
    ``syntax.caseSensitive``. :func:`compile_profile` does both.
    """
    if not isinstance(pattern, str):
        return pattern
    out: List[str] = []
    i = 0
    length = len(pattern)
    while i < length:
        char = pattern[i]
        if char == "\\":
            pair = pattern[i : i + 2]
            if pair == "\\s":
                out.append("[%s]" % _JS_SPACE)
            elif pair == "\\S":
                out.append("[^%s]" % _JS_SPACE)
            else:
                out.append(pair)
            i += 2
            continue
        if char == "[":
            end = _class_end(pattern, i)
            if end < 0:
                # Unclosed: not a pattern either language compiles, so nothing to translate.
                out.append(pattern[i:])
                break
            out.append(_py_class(pattern[i + 1 : end]))
            i = end + 1
            continue
        if char == ".":
            out.append(_JS_DOT)
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
    detect_vetoes = [
        _compile_pattern(source, "detect.vetoes[%d]" % i, flags)
        for i, source in enumerate(detect.get("vetoes") or [])
    ]

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
        "detect_vetoes": detect_vetoes,
        "section_heading": _compile_optional(syntax.get("sectionHeading"), "syntax.sectionHeading", flags),
        "continuation": _compile_optional(syntax.get("continuation"), "syntax.continuation", flags),
        "continuation_start": _compile_optional(
            syntax.get("continuationStart"), "syntax.continuationStart", flags
        ),
        "variables": _compile_optional(syntax.get("variables"), "syntax.variables", flags),
        # P8 (AD-24) and the M8 integration: the patterns of the turning dialects, compiled
        # here once like every other one, under the names the TypeScript side uses.
        "assignment": _compile_optional(syntax.get("assignment"), "syntax.assignment", flags),
        "labels": _compile_optional(syntax.get("labels"), "syntax.labels", flags),
        "system_variables": _compile_optional(syntax.get("systemVariables"), "syntax.systemVariables", flags),
        "header": _compile_optional(syntax.get("header"), "syntax.header", flags),
        "names": _compile_optional(syntax.get("names"), "syntax.names", flags),
        # Phase 2 (plan §7.16): a program name in place of a program number is one token.
        "program_names": _compile_optional(syntax.get("programNames"), "syntax.programNames", flags),
        # M12.5 (plan §7.16 #179): text the control keeps, and a program name behind a call.
        "free_text": _compile_list(syntax.get("freeText"), "syntax.freeText", flags),
        "call_targets": (
            _compile_pattern(_dict(syntax.get("callTargets")).get("pattern"), "syntax.callTargets.pattern", flags)
            if syntax.get("callTargets") is not None
            else None
        ),
        "tool_trigger": _compile_pattern(tool_call.get("trigger"), "toolCall.trigger", flags),
        "tool_ignore": _compile_optional(tool_call.get("ignore"), "toolCall.ignore", flags),
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

    program_name_pattern = syntax.get("programNames")
    program_name_lead = (
        ord(program_name_pattern[0])
        if isinstance(program_name_pattern, str)
        and program_name_pattern != ""
        and _LITERAL_LEAD.match(program_name_pattern)
        else _NO_CHAR
    )

    incremental_prefix = syntax.get("incrementalPrefix")
    separator = syntax.get("decimalSeparator")
    separator_alt = syntax.get("decimalSeparatorAlt")
    skip_codes = set(skip.codes if skip is not None else [])

    main_prefix = block_number.get("mainPrefix")
    main_start = main_prefix if isinstance(main_prefix, str) and main_prefix != "" and main_prefix not in prefixes else None
    exponent_marker = syntax.get("exponentMarker")

    mask_lead_pattern = _build_mask_lead_pattern(
        comments, syntax.get("strings") is True, program_name_pattern, program_name_lead
    )

    # M12.5 (plan §7.16 #179).
    colon_words = sorted(
        (
            name if case_sensitive else name.upper()
            for name in (syntax.get("colonWords") if isinstance(syntax.get("colonWords"), list) else [])
            if isinstance(name, str) and name != ""
        ),
        key=lambda name: -len(name),
    )
    call_targets = _dict(syntax.get("callTargets"))
    call_after = _canonical_keywords(call_targets.get("after"))
    call_pattern = cp.patterns.get("call_targets")
    plain_text_run = syntax.get("plainTextRun")

    return _LexSpec(
        packed=syntax.get("wordSeparatorRequired") is not True,
        case_sensitive=case_sensitive,
        comments=comments,
        strings=syntax.get("strings") is True,
        block_number_mode="leading-integer" if block_number.get("mode") == "leading-integer" else "prefix",
        block_number_prefixes=prefixes,
        block_number_starts=prefixes if main_start is None else prefixes + [main_start],
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
        decimal_point_alt=ord(separator_alt) if isinstance(separator_alt, str) and len(separator_alt) == 1 else _NO_CHAR,
        operators=frozenset(operators),
        # M12.5: ``syntax.tapeMarker: false`` says the dialect has no tape (Klartext).
        tape_marker=syntax.get("tapeMarker") is not False
        and _PERCENT not in comment_leads
        and _PERCENT not in skip_codes,
        # A main block number with the prefix `:` (Sinumerik) is read before the program
        # marker is asked, and `:1234` is that block number there, not the punched-tape marker.
        colon_program=block_number.get("mode") != "leading-integer"
        and _COLON not in comment_leads
        and main_start != ":",
        sequence_names=syntax.get("sequenceNames") is True,
        labels=cp.patterns.get("labels"),
        header=cp.patterns.get("header"),
        system_variables=cp.patterns.get("system_variables"),
        assignment=cp.patterns.get("assignment"),
        calls=syntax.get("calls") is True,
        assignment_index=syntax.get("assignmentIndex") is True,
        exponent=(
            (exponent_marker if case_sensitive else exponent_marker.upper())
            if isinstance(exponent_marker, str)
            else ""
        ),
        names=cp.patterns.get("names"),
        symbol_addresses=frozenset(
            ord(mark)
            for mark in (syntax.get("symbolAddresses") if isinstance(syntax.get("symbolAddresses"), list) else [])
            if isinstance(mark, str) and len(mark) == 1
        ),
        program_names=cp.patterns.get("program_names"),
        program_name_lead=program_name_lead,
        mask_lead_pattern=mask_lead_pattern,
        free_text=list(cp.patterns.get("free_text") or []),
        colon_words=colon_words,
        call_after=call_after if call_pattern is not None else frozenset(),
        call_pattern=call_pattern if call_after else None,
        label_after=_canonical_keywords(syntax.get("labelAfter")),
        declare_after=_canonical_keywords(syntax.get("declareAfter")),
        plain_text_run=(
            plain_text_run
            if isinstance(plain_text_run, int) and not isinstance(plain_text_run, bool) and plain_text_run >= 2
            else 0
        ),
    )


def _canonical_keywords(value: Any) -> frozenset:
    """A keyword list as the keyword tokens report it: upper case, one blank between the parts."""
    out = set()
    for entry in value if isinstance(value, list) else []:
        if isinstance(entry, str):
            parts = [part for part in re.split(r"\s+", entry) if part != ""]
            if parts:
                out.add(" ".join(parts).upper())
    return frozenset(out)


def _lex_spec(cp: CompiledProfile) -> _LexSpec:
    """The scanner's view of ``cp``, built once and cached on it."""
    if cp.spec is None:
        cp.spec = _build_spec(cp)
    return cp.spec


def _escape_for_char_class(char: str) -> str:
    """Escapes a character for use inside a ``[...]`` character class."""
    return "\\" + char if char in "]\\^-" else char


def _build_mask_lead_pattern(
    comments: List[_CommentMarker],
    strings: bool,
    program_name_source: Optional[str],
    program_name_lead: int,
) -> Optional[Any]:
    """Builds ``_LexSpec.mask_lead_pattern``; mirrors ``buildMaskLeadPattern`` (``tokenizer.ts``).

    A comment marker's lead goes in both cases, because ``_comment_at`` compares
    case-folded (``_to_upper`` on both sides); the program-name lead goes in exactly as it
    is, because ``_program_name_end_at`` compares it raw, with no case folding — mirroring
    that quirk is what keeps the fast path byte-identical to the loop it replaces.
    """
    if program_name_source is not None and program_name_lead == _NO_CHAR:
        return None

    leads = set()
    for marker in comments:
        leads.add(marker.code)
        leads.add(marker.code + 32 if 0x41 <= marker.code <= 0x5A else marker.code)
    if strings:
        leads.add(_QUOTE)
    if program_name_source is not None:
        leads.add(program_name_lead)

    if not leads:
        return re.compile(r"(?!)")  # never matches: nothing this profile masks ever starts a span

    chars = "".join(_escape_for_char_class(chr(code)) for code in sorted(leads))
    return re.compile(f"[{chars}]")


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


def _is_identifier_start(code: int) -> bool:
    """True for the first character of an identifier: a letter or ``_``.

    It is also what a value must not run into if it is to stay a value
    (``2.5D_MILLING`` is a name, not ``2.5`` and ``D_MILLING``).
    """
    return _is_letter(code) or code == _UNDERSCORE


def _identifier_end_at(line: str, p: int, limit: int) -> int:
    """End of the identifier at ``p`` (``CYCLE81``, ``LOOP_A``), or ``p`` when there is none."""
    if p >= limit or not _is_identifier_start(ord(line[p])):
        return p
    i = p + 1
    while i < limit:
        code = ord(line[i])
        if not _is_letter(code) and not _is_digit(code) and code != _UNDERSCORE:
            break
        i += 1
    return i


def _skip_space(line: str, p: int, limit: int) -> int:
    """The first position at or behind ``p`` that is not whitespace, ``limit`` at the latest."""
    i = p
    while i < limit and _is_space(ord(line[i])):
        i += 1
    return i


def _name_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the name at ``p`` (``syntax.names``: ``XBOT``, ``LOOP_A``, ``DIA1``), or ``p``.

    ``p`` comes back when the profile declares no names or none starts there.
    """
    if spec.names is None or p >= limit:
        return p
    match = spec.names.match(line, p)
    if match is None or match.end() == p:
        return p
    return min(match.end(), limit)


def _is_identifier_part(code: int) -> bool:
    """True for a character that continues an identifier: a letter, a digit or ``_``."""
    return _is_letter(code) or _is_digit(code) or code == _UNDERSCORE


def _letters_end_at(line: str, p: int, limit: int) -> int:
    """End of the run of letters at ``p`` (``p`` when there is none)."""
    i = p
    while i < limit and _is_letter(ord(line[i])):
        i += 1
    return i


@dataclass
class _ColonWord:
    name: str
    end: int
    value: Optional["_ValueRead"]
    value_start: int


def _colon_word_at(line: str, p: int, limit: int, spec: _LexSpec) -> Optional[_ColonWord]:
    """The colon word at ``p`` (``syntax.colonWords``, M12.5), or ``None``.

    A listed name, a ``:`` and a value (a number, or letters such as ``ON``) that ends at a
    blank, a comment or the end of the block. ``None`` where ``p`` stands inside an identifier.
    """
    if p > 0 and _is_identifier_part(ord(line[p - 1])):
        return None
    for name in spec.colon_words:
        colon = p + len(name)
        if colon >= limit or ord(line[colon]) != _COLON or not _match_literal(line, p, name, spec.case_sensitive):
            continue
        value_start = colon + 1
        value = _read_value(line, value_start, limit, spec, False)
        end = value.end if value is not None else _letters_end_at(line, value_start, limit)
        if end == value_start:
            continue
        if end < limit and not _is_space(ord(line[end])) and not (spec.comments and _comment_at(line, end, spec)):
            continue
        return _ColonWord(name=name, end=end, value=value, value_start=value_start)
    return None


def _starts_value(code: int, spec: _LexSpec) -> bool:
    """True when ``code`` starts the value of a word: ``X10.``, ``X.5``, ``X-1``, ``X#1``, ``X[#1]``."""
    return (
        _is_digit(code)
        or code == spec.decimal_point
        or code == _PLUS
        or code == _MINUS
        or code == _BRACKET_OPEN
        or (spec.variable_lead != _NO_CHAR and code == spec.variable_lead)
    )


def _plain_text_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the plain-text run at ``p`` (``syntax.plainTextRun``, M12.5), or ``p``.

    At least ``plain_text_run`` letters in a row; the run goes on over blanks and further
    groups of letters and stops in front of a group that is a keyword or has a value behind
    it (``X10.``, ``S 500``). Mirrors ``plainTextEndAt`` in ``tokenizer.ts``.
    """
    end = _letters_end_at(line, p, limit)
    if end - p < spec.plain_text_run:
        return p
    while True:
        q = _skip_space(line, end, limit)
        if q >= limit or q == end or not _is_letter(ord(line[q])):
            return end
        if _match_keyword(line, q, limit, spec) is not None:
            return end
        group_end = _letters_end_at(line, q, limit)
        r = _skip_space(line, group_end, limit)
        if r < limit and _starts_value(ord(line[r]), spec):
            return end
        end = group_end


def _free_text_at(line: str, p: int, limit: int, spec: _LexSpec) -> Optional[Tuple[int, int]]:
    """The span of the ``text`` group of the first ``syntax.freeText`` pattern that matches at ``p``.

    M12.5. A group that is empty, did not take part, or runs past ``limit`` (into a Klartext
    ``~``) is no text.
    """
    for regex in spec.free_text:
        match = regex.match(line, p)
        if match is None or "text" not in regex.groupindex:
            continue
        start, end = match.span("text")
        if start >= p and end > start and end <= limit:
            return (start, end)
    return None


def _target_behind_keyword(tokens: List["Token"], line: str, p: int, limit: int, spec: _LexSpec, keyword: str) -> int:
    """What stands behind a keyword that names a target (M12.5).

    A program name behind a ``syntax.callTargets`` keyword (``CALL OABCD``) is a
    ``programMarker``, a name behind a ``syntax.labelAfter`` keyword (``GOTOF SKIPSIM``) a
    ``label``. Pushes the blanks and the token and returns the position behind it, or returns
    ``p`` and pushes nothing. A jump to a block number (``GOTOF N100``), a keyword, a call, an
    assignment and an indexed name are no target. Mirrors ``targetBehindKeyword``.
    """
    calls = spec.call_pattern is not None and keyword in spec.call_after
    jumps = keyword in spec.label_after
    if not calls and not jumps:
        return p
    q = _skip_space(line, p, limit)
    if q >= limit:
        return p

    if calls:
        match = spec.call_pattern.match(line, q)
        end = match.end() if match is not None else q
        if end > q and end <= limit and (end == limit or not _is_identifier_part(ord(line[end]))):
            _push_space(tokens, line, p, limit)
            _push(tokens, "programMarker", line, q, end)
            return end

    if jumps and _is_identifier_start(ord(line[q])):
        end = _identifier_end_at(line, q, limit)
        behind = _skip_space(line, end, limit)
        nxt = ord(line[behind]) if behind < limit else _NO_CHAR
        if nxt in (_PAREN_OPEN, _EQUALS, _BRACKET_OPEN):
            return p
        matched = _match_keyword(line, q, limit, spec)
        if matched is not None and matched[0] == end:
            return p
        block = _scan_block_number(line, q, limit, spec)
        if block is not None and block.end == end:
            return p
        # ``GOTOF R10``: a variable (``syntax.variables``) is a computed target, not a label.
        if spec.variables is not None:
            variable = spec.variables.match(line, q)
            if variable is not None and variable.end() == end and end > q:
                return p
        _push_space(tokens, line, p, limit)
        token = _push(tokens, "label", line, q, end)
        token.address = token.text if spec.case_sensitive else token.text.upper()
        return end
    return p


def _declares_name_here(tokens: List["Token"], spec: _LexSpec) -> bool:
    """True when an identifier here is a name a ``syntax.declareAfter`` block declares.

    The last token is a type keyword (any keyword but the declaring one), the size of one
    (``STRING[32]``), or a ``,``. Mirrors ``declaresNameHere``.
    """
    i = len(tokens) - 1
    while i >= 0 and tokens[i].kind == "whitespace":
        i -= 1
    if i < 0:
        return False
    last = tokens[i]
    if last.kind == "operator":
        return last.text == ","
    if last.kind == "expression":
        i -= 1
        while i >= 0 and tokens[i].kind == "whitespace":
            i -= 1
        if i < 0:
            return False
        last = tokens[i]
    return last.kind == "keyword" and last.address is not None and last.address not in spec.declare_after


def _program_name_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the program name at ``p`` (``syntax.programNames``: ``<SHAFT_T12>``), or ``p``.

    ``p`` comes back when the profile declares none or none starts there. Shared with
    :func:`mask_comments`, which masks exactly the names the tokenizer reads.
    """
    regex = spec.program_names
    if regex is None or p >= limit:
        return p
    if spec.program_name_lead != _NO_CHAR and ord(line[p]) != spec.program_name_lead:
        return p
    match = regex.match(line, p)
    if match is None or match.end() == p or match.end() > limit:
        return p
    return match.end()


def _argument_list_at(line: str, p: int, identifier_end: int, after_blanks: int, limit: int, spec: _LexSpec) -> int:
    """Where the argument list of the identifier ``line[p:identifier_end]`` opens, or -1.

    The ``(`` stands right behind the identifier (``CYCLE81(…)``, ``L10(1)``), or behind
    blanks when the identifier is a name the profile declares (``syntax.names``):
    ``MSG ("TEXT")``, ``CYCLE840 (…)``. A word of one letter and a number keeps its bracket
    touching it to be a call, so ``M30 (END)`` in a program written for another control
    stays the ``M30`` it says. ``after_blanks`` is the first position behind the identifier
    that is not whitespace.
    """
    if after_blanks >= limit or ord(line[after_blanks]) != _PAREN_OPEN:
        return -1
    if after_blanks == identifier_end:
        return after_blanks
    return after_blanks if _name_end_at(line, p, limit, spec) == identifier_end else -1


def _arguments_end_at(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """Where the argument list that starts at the ``(`` at ``p`` ends (exclusive).

    Parentheses nest, and a ``)`` inside a string does not close the list, which is what
    holds ``MSG("A;B")`` together. A comment marker outside a string ends the list where
    it stands, so an unclosed ``(`` can never swallow a comment: the tokenizer and
    :func:`mask_comments` have to agree on where a comment begins, whatever the line says.
    """
    depth = 0
    i = p
    while i < limit:
        code = ord(line[i])
        if spec.strings and code == _QUOTE:
            i = _string_end_at(line, i, limit)
            continue
        if i > p and spec.comments and _comment_at(line, i, spec) is not None:
            return i
        if code == _PAREN_OPEN:
            depth += 1
        elif code == _PAREN_CLOSE:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
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
    """End of the number that starts at ``p``, or ``p`` when there is none (a sign is not one).

    ``decimal_point_alt`` (the Klartext decimal comma, §7.16 / R4) starts a fraction
    exactly as ``decimal_point`` does; ``_read_value`` decides which one it was, and only
    when the strict parse of the text this scans fails.
    """
    i = p
    digits = False
    while i < limit and _is_digit(ord(line[i])):
        i += 1
        digits = True
    if i < limit and ord(line[i]) in (spec.decimal_point, spec.decimal_point_alt):
        after_point = i + 1
        j = after_point
        while j < limit and _is_digit(ord(line[j])):
            j += 1
        if digits or j > after_point:
            digits = True
            i = j
    if not digits:
        return p
    return i if spec.exponent == "" else _exponent_end_at(line, i, limit, spec)


def _exponent_end_at(line: str, i: int, limit: int, spec: _LexSpec) -> int:
    """Where a number that ends at ``i`` really ends once its exponent is read.

    The exponent is ``syntax.exponentMarker``, an optional sign and at least one digit
    (``1.5EX3``, ``2EX-4``); anything less leaves the number as it is.
    """
    if not _match_literal(line, i, spec.exponent, spec.case_sensitive) or i + len(spec.exponent) > limit:
        return i
    j = i + len(spec.exponent)
    if j < limit and ord(line[j]) in (_PLUS, _MINUS):
        j += 1
    digits_from = j
    while j < limit and _is_digit(ord(line[j])):
        j += 1
    return j if j > digits_from else i


@dataclass
class _ValueRead:
    end: int
    text: str
    value: Optional[NumericLiteral]


def _parse_value(text: str, spec: _LexSpec) -> Optional[NumericLiteral]:
    """``parse_number``, plus the Klartext decimal comma (§7.16 / R4): retried with
    ``decimal_point_alt`` read as the point when the strict parse fails.

    ``parse_number`` itself stays exactly the contract it always was — ``.`` only, no
    comma, no profile — mirroring ``parseNumber`` in ``core/nc/numbers.ts``, so neither
    side widens what a number is for every other dialect. ``text`` only ever carries a
    comma here because ``_number_end_at`` already decided, from the profile's own
    ``decimalSeparatorAlt``, that this text is a number; the retry just reads the digits
    it already agreed to. The result keeps ``text`` as ``raw``, comma included, so
    ``format_number`` can tell which separator to write back.
    """
    value = parse_number(text)
    if value is not None or spec.decimal_point_alt == _NO_CHAR:
        return value
    alt = chr(spec.decimal_point_alt)
    if alt not in text:
        return None
    normalized = parse_number(text.replace(alt, "."))
    return None if normalized is None else replace(normalized, raw=text)


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
        return _ValueRead(end=number_end, text=text, value=_parse_value(text, spec))

    if spec.variables is not None and start < limit:
        match = spec.variables.match(line, start)
        # An empty match is no variable: `R?\d*` matches nothing in front of every letter.
        if match is not None and match.end() > start and match.end() <= limit:
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


def _assigned_value_end_at(line: str, r: int, limit: int, spec: _LexSpec) -> int:
    """End of the value behind an ``=`` (exclusive), or ``r`` when the address takes none.

    A string, a bracket expression and a call are taken whole, because none of them may
    be cut at a space; anything else runs to the end of the word, so ``X=V1+V2`` keeps its
    expression together while ``SB=1200 M13`` stops in front of ``M13``. A comment behind
    the ``=`` ends the value, so ``X= (SET LATER)`` is an address without one. A call is
    read here as everywhere else, blanks in front of its bracket included (``X=AC (10)``).
    """
    if r >= limit:
        return r
    code = ord(line[r])
    if spec.strings and code == _QUOTE:
        return _string_end_at(line, r, limit)
    if code == _BRACKET_OPEN:
        return _expression_end_at(line, r, limit)
    if spec.calls:
        name_end = _identifier_end_at(line, r, limit)
        if name_end > r:
            open_at = _argument_list_at(line, r, name_end, _skip_space(line, name_end, limit), limit, spec)
            if open_at >= 0:
                return _arguments_end_at(line, open_at, limit, spec)
    return _chunk_end_at(line, r, limit, spec)


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

    for prefix in spec.block_number_starts:
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


@dataclass
class _SequenceNameScan:
    start: int
    end: int
    name_start: int


def _scan_sequence_name(line: str, p: int, limit: int, spec: _LexSpec) -> Optional[_SequenceNameScan]:
    """The sequence *name* at ``p`` (``NLAP1``), where the block-number prefix also names blocks.

    Only on a profile with ``syntax.sequenceNames``. A name is the prefix, a letter, up to
    three more letters or digits, and a separator or the end of the block behind it. The
    separator is what the control insists on, and it is what keeps this rule off ordinary
    code: ``N100G0`` stays a numbered block and ``NLAP1G85`` is not a name at all. A name
    is never a block number, so renumbering never rewrites one.
    """
    if not spec.sequence_names:
        return None
    for prefix in spec.block_number_prefixes:
        if not _match_literal(line, p, prefix, spec.case_sensitive):
            continue
        name_start = p + len(prefix)
        if name_start >= limit or not _is_letter(ord(line[name_start])):
            continue
        i = name_start + 1
        while i < limit and i - name_start < 4:
            code = ord(line[i])
            if not _is_letter(code) and not _is_digit(code):
                break
            i += 1
        if i < limit and not _is_space(ord(line[i])):
            continue
        # M12.5: a command of the dialect that has the shape of a name (Okuma `NOEX`, which
        # opens a variable-setting sequence, OSP-P200L user task section) is that command.
        keyword = _match_keyword(line, p, limit, spec)
        if keyword is not None and keyword[0] == i:
            continue
        return _SequenceNameScan(start=p, end=i, name_start=name_start)
    return None


@dataclass
class _LabelSpan:
    start: int
    end: int
    name: str


def _label_span_of(line: str, spec: _LexSpec) -> Optional[_LabelSpan]:
    """The label definition of the line (``LOOP_A:``), or ``None``.

    ``start`` is where the ``name`` group starts and ``end`` where the whole match ends.
    The pattern is anchored at the start of the line and carries the block skip and the
    block number in front of the name, because a label may itself start with the
    block-number prefix (``NEXT_PART:``) and has to be recognised before it. One match per
    line answers both places a label may stand: in front of a block number and behind one.
    """
    regex = spec.labels
    if regex is None or "name" not in regex.groupindex:
        return None
    match = regex.match(line)
    if match is None:
        return None
    name = match.group("name")
    if not isinstance(name, str) or name == "":
        return None
    return _LabelSpan(start=match.start("name"), end=match.end(), name=name)


def _scan_skip(line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """End of the block-skip mark at ``p``, or ``p`` when there is none."""
    skip = spec.skip
    if skip is None or p >= limit or ord(line[p]) not in skip.codes:
        return p
    end = p + 1
    if skip.levels and end < limit:
        # `/0` is a level too (Sinumerik writes it for the level `/` means), so the block
        # number behind it is still read as one.
        level = ord(line[end])
        if _ZERO <= level <= _NINE:
            end += 1
    return end


def _push_skips(tokens: List[Token], line: str, p: int, limit: int, spec: _LexSpec) -> int:
    """Pushes the block-skip marks at ``p`` and the blanks behind each; returns the position behind the last.

    One mark is the usual case; a profile whose skip mark takes a level may stack several
    (``/1 /3 N10 G1``, a block skipped on either of two levels), and each is a ``skip``
    token of its own. Without levels a second ``/`` is no mark, only what it was before.
    """
    at = p
    while True:
        end = _scan_skip(line, at, limit, spec)
        if end == at:
            return at
        _push(tokens, "skip", line, at, end)
        at = _push_space(tokens, line, end, limit)
        if spec.skip is None or not spec.skip.levels:
            return at


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


@dataclass
class _IndexedAssignment:
    address: str
    index: str
    equals: int


def _indexed_assignment_at(line: str, p: int, name_end: int, limit: int, spec: _LexSpec) -> Optional[_IndexedAssignment]:
    """An indexed assignment at ``p`` (``LIMS[2]=1800``, ``S[SPI]=300``), or ``None``.

    The identifier ``[p, name_end)``, a bracket expression touching it, and an ``=`` (not
    ``==``) behind that. ``address`` is the identifier as ``syntax.assignment`` accepts it,
    ``index`` the text between the brackets with the blanks around it taken off, ``equals``
    the position of the ``=``. The pattern is asked about the identifier with its ``=``
    appended, which is the question it is written to answer (``(?=\\s*=(?!=))``): the real
    ``=`` stands behind the bracket here. Mirrors ``indexedAssignmentAt`` (``tokenizer.ts``).
    """
    assignment = spec.assignment
    if assignment is None or name_end >= limit or ord(line[name_end]) != _BRACKET_OPEN:
        return None
    # The scanner stops at every letter of a long packed run, and each stop would slice the
    # rest of the run and read the bracket behind it: bounded, so a line of 32k characters
    # costs what its length says. No name a program writes comes near 64 characters.
    if name_end - p > _MAX_INDEXED_NAME:
        return None
    close = _expression_end_at(line, name_end, limit)
    if close <= name_end + 1 or ord(line[close - 1]) != _BRACKET_CLOSE:
        return None
    equals = _skip_space(line, close, limit)
    if equals >= limit or ord(line[equals]) != _EQUALS or _code_at(line, equals + 1) == _EQUALS:
        return None
    start = name_end + 1
    stop = close - 1
    while start < stop and _is_space(ord(line[start])):
        start += 1
    while stop > start and _is_space(ord(line[stop - 1])):
        stop -= 1
    if start == stop:
        return None  # `S[]=5` indexes nothing
    name = line[p:name_end]
    match = assignment.match(name + "=")
    if match is None or match.end() != len(name):
        return None
    return _IndexedAssignment(
        address=name if spec.case_sensitive else name.upper(), index=line[start:stop], equals=equals
    )


def _ends_operand(tokens: List[Token], spec: _LexSpec) -> bool:
    """True when a ``+`` or ``-`` behind these tokens joins two operands instead of signing one."""
    i = len(tokens) - 1
    while i >= 0 and tokens[i].kind == "whitespace":
        i -= 1
    if i < 0:
        return False
    token = tokens[i]
    # A call gives a value back, so `SETVAL(1)-2` subtracts instead of starting a negative
    # number. A label does not, and it is not in this list.
    if token.kind in ("word", "variable", "expression", "string", "blockNumber", "call"):
        return True
    # A name (`syntax.names`) is a value like a variable, so `XNOW-2` subtracts. Any other
    # unknown token is not an operand; a name is the one that starts like a name.
    if token.kind == "unknown":
        return spec.names is not None and _name_end_at(token.text, 0, len(token.text), spec) > 0
    return False


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


#: Token kinds that may stand in front of a name that is alone in its block (M9-3).
_BLOCK_HEAD_KINDS = frozenset(("whitespace", "blockNumber", "skip", "label"))


def _name_alone_in_block(tokens: List[Token], line: str, end: int, limit: int, spec: _LexSpec) -> bool:
    """True when the name ending at ``end`` is all its block writes (owner decision of
    2026-10-08, M9-3): before it only a block number, skip marks, a label and blanks, behind
    it only blanks and a comment. The twin of ``nameAloneInBlock`` in ``tokenizer.ts``."""
    for token in tokens:
        if token.kind not in _BLOCK_HEAD_KINDS:
            return False
    q = _skip_space(line, end, limit)
    return q >= limit or (bool(spec.comments) and _comment_at(line, q, spec) is not None)


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

    The turning dialects switch on seven more ``syntax`` fields (plan AD-24 and §7.16),
    each of them off unless the profile sets it, so a profile that names none of them
    tokenizes exactly as before:

    ``header``
        a file header at the head of a line (``$PART.MIN%``, ``%_N_PART_MPF``): one
        ``programMarker`` with no address
    ``sequenceNames``
        ``NLAP1`` is a ``label``, never a block number, at the head of a block and behind
        a jump (``GOTO NLAP1``)
    ``labels``
        ``LOOP_A:`` at the head of a block, in front of the block number or behind it
    ``systemVariables``
        tried before ``variables``, so ``VZOFZ`` is not ``V`` with a value
    ``assignment``
        ``SB=1200``: a word whose address is the identifier in front of the ``=``, all of
        it; a variable keeps its own rule, so ``R1=R2*2`` reads as Fanuc ``#1=#2-5`` does
    ``calls``
        an identifier in front of ``(`` (a name also with blanks between the two) is one
        ``call`` token, arguments included
    ``names``
        a name the program gives itself (``XNOW``, ``LAST_CUT``) is one ``unknown`` token;
        a keyword is one only where the name at its position is no longer than it

    Phase 2 adds one for the ISO dialects, opt-in the same way (plan §7.16):

    ``programNames``
        a program name in place of a program number (Fanuc ``<SHAFT_T12>``, at the head
        of a program and behind ``M98``/``G65``) is one ``programMarker`` with no address,
        wherever it stands

    M9 (plan section 7.1 "The M9 syntax pins") adds four more, opt-in like the rest, and two
    rules that need no field:

    ``blockNumber.mainPrefix``
        a second block-number prefix that marks a main block (Sinumerik ``:123``): a
        ``blockNumber`` token with that ``address``. It has the shape of ``N123``, so the
        punched-tape ``:1234`` program marker yields to it
    ``assignmentIndex``
        an assignment address may carry one bracket index in front of its ``=``:
        ``LIMS[2]=1800`` is one ``word`` with ``address`` ``LIMS``, ``index`` ``2`` and
        ``value_text`` ``1800``. ``syntax.assignment`` is asked about the identifier with its
        ``=`` appended, which is the question that pattern is written to answer
    ``exponentMarker``
        the letters of an exponent inside a number (Sinumerik ``EX``): ``1.5EX3`` is the one
        value of its word, ``value`` ``None`` because nothing computes with an exponent yet
    ``extendedAddresses``
        read by the grammar and the hover only; no token changes
    several skip levels
        on a profile whose skip mark takes a level, each mark at the head of a block is a
        ``skip`` token of its own (``/1 /3 N10 G1``)
    ``;``
        an operator where it starts no comment: the end-of-block character of the ISO tape
        format. Where words are separated, a number that runs straight into letters is one
        ``unknown`` token (a Klartext program name ``2.5D_MILLING``), not a value and a name

    A block-skip level is one digit, ``0`` included: ``/0`` is the level ``/`` means.

    M12.5 (plan section 7.16 #179) adds seven more, opt-in like the rest (``tokenizer.ts``
    has the full list): ``freeText`` (the ``text`` group of a pattern tried where the block
    starts is one ``text`` token), ``colonWords`` (``VC:120``), ``callTargets`` (``CALL
    OABCD`` names a program), ``labelAfter`` (the name behind ``GOTOF`` is a ``label``),
    ``declareAfter`` (the names a ``DEF`` block declares are variables), ``plainTextRun``
    (free text outside a comment is one ``unknown`` token) and ``tapeMarker`` (``false``: no
    lone ``%`` tape marker); and a sequence name that is exactly a keyword (``NOEX``) is the
    keyword.
    """
    spec = _lex_spec(cp)
    tokens: List[Token] = []
    # The opt-in fields, read once per line: most profiles set none of them, and a local
    # costs less than an attribute on every token of a long program.
    names = spec.names
    calls = spec.calls
    system_variables = spec.system_variables
    assignment = spec.assignment
    sequence_names = spec.sequence_names

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

    # The same holds for a run of letters, digits and underscores in a packed dialect. `p`
    # stops at every letter of `G1X1G1X1…`, and the `calls` and `assignment` rules both ask
    # where the identifier at `p` ends and what stands behind it: asked afresh at every
    # letter, a script needed nine seconds for one Sinumerik line of 16k such characters.
    # Every letter of a run has the same end and the same character behind the blanks that
    # follow it, so one scan per run answers them all: `run[0]` is where the identifier
    # ends, `run[1]` the first position behind it that is not whitespace. Only ask at a
    # letter or `_`: a digit inside a run starts no identifier.
    run = [-1, -1]

    def identifier_from(frm: int) -> int:
        if frm >= run[0]:
            run[0] = _identifier_end_at(line, frm, limit)
            run[1] = _skip_space(line, run[0], limit)
        return run[0]

    def push_label(start: int, end: int, name: str) -> int:
        """Pushes a label and the whitespace behind it, and returns the new position."""
        token = _push(tokens, "label", line, start, end)
        token.address = name if spec.case_sensitive else name.upper()
        return _push_space(tokens, line, end, limit)

    # A file header is not an NC block: `$PART.MIN%` and `%_N_PART_MPF` are one marker, so
    # the `$` in front of it is not a hexadecimal constant and the `%` not a tape marker.
    if at_head and spec.header is not None and p == 0:
        match = spec.header.match(line)
        if match is not None and match.end() > 0:
            end = min(match.end(), limit)
            if end > 0:
                _push(tokens, "programMarker", line, 0, end)
                p = _push_space(tokens, line, end, limit)
                at_head = False

    if at_head:
        if spec.skip is not None and spec.skip.before:
            p = _push_skips(tokens, line, p, limit, spec)
        # A label may start with the block-number prefix (`NEXT_PART:`), so it is read
        # before the block number, and once more behind one, because a block may carry both.
        label = _label_span_of(line, spec) if spec.labels is not None else None
        if label is not None and label.start == p:
            p = push_label(label.start, label.end, label.name)
            at_head = False
        else:
            named = _scan_sequence_name(line, p, limit, spec) if sequence_names else None
            block = None if named is not None else _scan_block_number(line, p, limit, spec)
            if named is not None:
                p = push_label(named.start, named.end, line[named.name_start : named.end])
                at_head = False
            elif block is not None:
                token = _push(tokens, "blockNumber", line, block.start, block.end)
                digits = line[block.digits_start : block.end]
                if block.prefix != "":
                    token.address = block.prefix if spec.case_sensitive else block.prefix.upper()
                token.value_text = digits
                token.value = parse_number(digits)
                at_head = False
                p = _push_space(tokens, line, block.end, limit)
            if named is not None or block is not None:
                if spec.skip is not None and spec.skip.after:
                    p = _push_skips(tokens, line, p, limit, spec)
                if label is not None and label.start == p:
                    p = push_label(label.start, label.end, label.name)

    # A structure block (`12 * - ROUGHING`) is a heading; its text is read as a comment.
    if spec.section_heading is not None and p < limit and ord(line[p]) == _STAR and spec.section_heading.search(line):
        end = limit
        while end > p and _is_space(ord(line[end - 1])):
            end -= 1
        _push(tokens, "comment", line, p, end)
        p = end

    # M12.5 `syntax.freeText`: tried once, where the block starts. The line is read up to
    # the `text` group with the group's start as its limit, so no token can run into the
    # text; the group is one `text` token, and the rest is read as usual behind it.
    full_limit = limit
    text: Optional[Tuple[int, int]] = None
    if spec.free_text and p < limit:
        text = _free_text_at(line, p, limit, spec)
    if text is not None:
        limit = text[0]

    # `DEF INT COUNTER` (M12.5 `syntax.declareAfter`): set by the keyword that opens the block.
    declaring = False

    # Every rule below is bounded by `limit`, so `p` reaches the text's start exactly.
    while p < limit or (text is not None and p == text[0]):
        if text is not None and p == text[0]:
            _push(tokens, "text", line, text[0], text[1])
            p = text[1]
            limit = full_limit
            text = None
            continue
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

        # A program name (`syntax.programNames`) is one program marker wherever it stands:
        # at the head of a program it is what `O1234` would be, behind `M98` or `G65` the
        # program called. The control reads its characters like comment text, so nothing in
        # it is a word: letter by letter, `<SHAFT_F12>` held a feed a script would scale.
        program_name_end = _program_name_end_at(line, p, limit, spec)
        if program_name_end > p:
            _push(tokens, "programMarker", line, p, program_name_end)
            p = program_name_end
            continue

        # M12.5 `syntax.colonWords`: `VCONST:ON`, `VC:120`, `HSC-MODE:1` are one word each.
        if spec.colon_words and _is_letter(code):
            colon_word = _colon_word_at(line, p, limit, spec)
            if colon_word is not None:
                token = _push(tokens, "word", line, p, colon_word.end)
                token.address = colon_word.name
                token.value_text = line[colon_word.value_start : colon_word.end]
                if colon_word.value is not None:
                    token.value = colon_word.value.value
                p = colon_word.end
                continue

        # Where the profile declares names, a keyword is only one when the name that starts
        # here is no longer than it: `LOOP_A` and `GOTO100` are names, `LOOP` and `GOTOF`
        # keywords, `IF[` still a conditional.
        keyword = _match_keyword(line, p, limit, spec)
        if keyword is not None and names is not None and _name_end_at(line, p, limit, spec) > keyword[0]:
            keyword = None
        if keyword is not None:
            end, entry = keyword
            # `DEF` declares only where it opens the block (behind its number, skip marks or label).
            declares = entry.canonical in spec.declare_after and all(t.kind in _BLOCK_HEAD_KINDS for t in tokens)
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
            if declares:
                declaring = True
            if value is None:
                p = _target_behind_keyword(tokens, line, p, limit, spec, entry.canonical)
            continue

        # M12.5 `syntax.declareAfter`: on a `DEF` block, the name behind a type keyword (behind
        # its `[…]` size, if any) or behind a `,` is declared here, and is a `variable`. A `,`
        # is a separator on such a block, never the `,R` of a packed address.
        if declaring:
            if code == _COMMA:
                p = _push(tokens, "operator", line, p, p + 1).end
                continue
            if _is_identifier_start(code) and _declares_name_here(tokens, spec):
                p = _push(tokens, "variable", line, p, _identifier_end_at(line, p, limit)).end
                continue

        # An identifier written in front of `(` is one token, together with everything up
        # to the matching `)`. What the arguments mean is the cycle's business, and taking
        # them in one piece is what keeps the `;` of `MSG("A;B")` out of the comment rule.
        # A declared keyword matched above, so `IF(…)` is still a conditional and only an
        # identifier the profile does not know is a call. Blanks may stand between a name
        # and its bracket (`CYCLE840 (…)`, `MSG ("…")`): the control reads both spellings
        # as the same call, and read as a name and loose values, a tapping cycle would be
        # one the scripts never see (`_argument_list_at`).
        if calls and _is_identifier_start(code):
            name_end = identifier_from(p)
            open_at = _argument_list_at(line, p, name_end, run[1], limit, spec)
            if open_at >= 0:
                end = _arguments_end_at(line, open_at, limit, spec)
                token = _push(tokens, "call", line, p, end)
                name = line[p:name_end]
                token.address = name if spec.case_sensitive else name.upper()
                closed = end > open_at + 1 and ord(line[end - 1]) == _PAREN_CLOSE
                args = line[open_at + 1 : end - 1 if closed else end]
                if args != "":
                    token.value_text = args
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

        # System variables come first, so Okuma's `VZOFZ` is not the common variable `V`
        # with a value behind it and Sinumerik's `$AA_IM` not a stray `$`. An empty match
        # is no match: a token of no characters would leave `p` where it is, forever.
        if system_variables is not None:
            match = system_variables.match(line, p)
            if match is not None and p < match.end() <= limit:
                p = _push(tokens, "variable", line, p, match.end()).end
                continue

        if spec.variables is not None:
            match = spec.variables.match(line, p)
            if match is not None and p < match.end() <= limit:
                p = _push(tokens, "variable", line, p, match.end()).end
                continue
        # The indirect form `#[#1+1]`: the lead character on its own, then the expression.
        if code == spec.variable_lead and p + 1 < limit and ord(line[p + 1]) == _BRACKET_OPEN:
            p = _push(tokens, "variable", line, p, p + 1).end
            continue

        # An address that takes `=` and an expression (`SB=1200`, `CR=15`, `X=V1+V2`). The
        # token stays a word: the address is what stands in front of the `=`, and the value
        # is the text behind it, a literal only when the whole right-hand side is one, so
        # nothing that computes with NC numbers can ever scale `F=R1`.
        #
        # The address is the identifier at `p`, all of it, and the pattern is only asked
        # where that identifier has an `=` behind it (not the `==` of a comparison). The
        # `=` is found with the tokenizer's own whitespace rule, not the pattern's lookahead.
        if assignment is not None and _is_identifier_start(code):
            name_end = identifier_from(p)
            q = run[1]
            indexed = _indexed_assignment_at(line, p, name_end, limit, spec) if spec.assignment_index else None
            if indexed is not None:
                r = _skip_space(line, indexed.equals + 1, limit)
                value_end = _assigned_value_end_at(line, r, limit, spec)
                token = _push(tokens, "word", line, p, value_end if value_end > r else indexed.equals + 1)
                token.address = indexed.address
                token.index = indexed.index
                if value_end > r:
                    token.value_text = line[r:value_end]
                    token.value = parse_number(token.value_text)
                p = token.end
                continue
            if q < limit and ord(line[q]) == _EQUALS and _code_at(line, q + 1) != _EQUALS:
                match = assignment.match(line, p)
                if match is not None and match.end() == name_end:
                    r = _skip_space(line, q + 1, limit)
                    value_end = _assigned_value_end_at(line, r, limit, spec)
                    token = _push(tokens, "word", line, p, value_end if value_end > r else q + 1)
                    address = match.group(0)
                    token.address = address if spec.case_sensitive else address.upper()
                    if value_end > r:
                        token.value_text = line[r:value_end]
                        token.value = parse_number(token.value_text)
                    p = token.end
                    continue

        if code == _BRACKET_OPEN:
            end = _expression_end_at(line, p, limit)
            _push(tokens, "expression", line, p, end)
            p = end
            continue

        # A sequence name is one token wherever it stands. At the head of a block it names
        # the block; behind a jump it names the block jumped to (`GOTO NLAP1`), and there it
        # has to stay in one piece, because letter by letter a name such as `NFED1` would
        # turn into a feed word that a script would then scale. A numbered target
        # (`GOTO N200`) stays an `N` word: that one a renumber does have to rewrite.
        #
        # Away from the head the name needs whitespace in front of it as well as behind it.
        # Packed words are read letter by letter, and without that rule the `NG` of a word
        # such as `NTOOLING` would become a name in the middle of another one.
        if sequence_names and (p == 0 or _is_space(ord(line[p - 1]))):
            named = _scan_sequence_name(line, p, limit, spec)
            if named is not None:
                token = _push(tokens, "label", line, named.start, named.end)
                name = line[named.name_start : named.end]
                token.address = name if spec.case_sensitive else name.upper()
                p = named.end
                continue

        # A name the program gives itself (`syntax.names`): a variable, a jump target, a
        # subprogram called by its name. One token, so `XBOT` is no X word and `PASS2` no
        # S word of 2. Every rule above has had its turn, so `XNOW=62` is still an
        # assignment, `NAME(…)` a call and `NLAP1` a label.
        if names is not None:
            end = _name_end_at(line, p, limit, spec)
            if end > p:
                # Owner decision of 2026-10-08 (M9-3): on a profile with calls, a name that
                # stands alone in its block (`HOME`, `N200 MYSUB`, `CYCLE800`) calls the
                # subprogram or cycle of that name without arguments: the `call` token
                # `CYCLE800()` would be, with no `value_text`. A name among other words
                # (`G2 X10 Y10 CR15`) stays one `unknown` token.
                if calls and _name_alone_in_block(tokens, line, end, limit, spec):
                    token = _push(tokens, "call", line, p, end)
                    name = line[p:end]
                    token.address = name if spec.case_sensitive else name.upper()
                    p = end
                    continue
                _push(tokens, "unknown", line, p, end)
                p = end
                continue

        if spec.packed:
            # M12.5 `syntax.plainTextRun`: free text outside a comment is one unknown token.
            if spec.plain_text_run and _is_letter(code):
                end = _plain_text_end_at(line, p, limit, spec)
                if end > p:
                    _push_unknown(tokens, line, p, end)
                    p = end
                    continue
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
        elif code in spec.symbol_addresses:
            # `syntax.symbolAddresses` (M9-2): Klartext `CYCL DEF 7.1 #5` / `#Q5`, the row of
            # the datum table (TNC 640 cycles, cycle 7). The mark is the address of the value
            # packed behind it; anything else (`# 5`, a lone `#`) falls through unchanged.
            chunk_end = chunk_from(p)
            value = _read_value(line, p + 1, chunk_end, spec, False)
            if value is not None and value.end == chunk_end:
                token = _push(tokens, "word", line, p, chunk_end)
                _describe_word(token, line[p : p + 1], spec, value)
                p = chunk_end
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
            or code == spec.decimal_point_alt
            or ((code == _PLUS or code == _MINUS) and not _ends_operand(tokens, spec))
        ):
            stop = limit if spec.packed else chunk_from(p)
            value = _read_value(line, p, stop, spec, False)
            # Where words are separated, a number that runs straight into letters is no
            # value but a name that starts with digits (`BEGIN PGM 2.5D_MILLING MM`): one
            # token, as a name that starts with a letter already is.
            if (
                value is not None
                and not spec.packed
                and value.end < stop
                and _is_identifier_start(ord(line[value.end]))
            ):
                _push_unknown(tokens, line, p, stop)
                p = stop
                continue
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


def continues_block(line: str, cp: CompiledProfile) -> bool:
    """True when ``line`` belongs to the block **above** it by a marker at its start.

    That is ``syntax.continuationStart`` of the profile (M8, plan section 7.16 #27): Okuma
    writes the rest of a long block on lines that start with ``$`` (``N001 G71 X27.55 Z-30
    B60 D0.7 U0.1``, then ``$ H2.45 L2 F2 M23 M32 M73``), and the ``F2`` there is the lead
    of the ``G71`` thread cycle above it. The line tokenizes as any other; this is what a
    reader that works in blocks asks, and :meth:`ModalInterpreter.update` and
    :meth:`FeedModeTracker.update` take the answer as ``continued``. A trailing marker
    (Klartext ``~``) is the other kind and is carried by :class:`LineState` instead. A
    profile without the field has no such lines.
    """
    patterns = getattr(cp, "patterns", None) or {}
    pattern = patterns.get("continuation_start")
    return pattern is not None and pattern.search(line) is not None


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
        while True:
            end = _scan_skip(line, p, limit, spec)
            if end == p:
                break
            p = end
            while p < limit and _is_space(ord(line[p])):
                p += 1
            if not spec.skip.levels:
                break

    block = _scan_block_number(line, p, limit, spec)
    if block is None:
        return None

    text = line[block.digits_start : block.end]
    return {"value": int(text, 10), "text": text, "start": block.start, "end": block.end}


#: The characters of a program name that the mask turns into ``_``.
_MASK_NAME = re.compile(r"[A-Za-z0-9]")


def mask_comments(line: str, cp: CompiledProfile) -> str:
    """``line`` with every comment blanked out, same length. Mirrors ``maskComments``.

    Every code pattern of a profile (the tool call, the program start and end, the
    ``outline`` rules that are not ``comment`` or ``section``, the numbering triggers)
    runs against the masked line, so ``(T1 M6)`` inside a comment is never a tool change.
    The mask keeps the line's length and its offsets, so a match position on the masked
    line is a position in the real line. Strings stay as they are, because tool names are
    strings — and because a comment marker inside a string does not start a comment.

    Two spans are stepped over whole, so that nothing inside them opens a comment — the
    same two the tokenizer reads in one piece: a string (``MSG("A;B")`` is one Sinumerik
    call, and its ``;`` is text) and the file header of ``syntax.header``
    (``$PART.MIN%``), which detection reads off the masked line.

    A program name (``syntax.programNames``: Fanuc ``<SHAFT_T12>``) is neither blanked nor
    kept: each letter and digit becomes ``_`` and the rest stays (``<SHAFT-T12>`` masks as
    ``<_____-___>``). No code pattern finds a ``T12`` or an ``M30`` in it, a rule that
    looks for the name's shape still does, and the name is not mistaken for a comment.
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

    if spec.header is not None and p == 0:
        match = spec.header.match(line)
        if match is not None and match.end() > 0:
            p = min(match.end(), limit)

    # Whole-line fast path: see ``maskComments`` (``mask.ts``) for why. ``search(line, p)``
    # is Python's equivalent of the TS side's global-regex ``lastIndex`` scan — the first
    # match at or after ``p``, wherever in the rest of the line it falls.
    if p < limit and spec.mask_lead_pattern is not None:
        found = spec.mask_lead_pattern.search(line, p)
        if found is None or found.start() >= limit:
            return line if copied == 0 else masked + line[copied:]

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
            name_end = _program_name_end_at(line, p, limit, spec)
            if name_end > p:
                masked += line[copied:p] + _MASK_NAME.sub("_", line[p:name_end])
                copied = name_end
                p = name_end
                continue
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

    # The Klartext decimal comma (§7.16 / R4): a rewrite keeps the separator the value was
    # written with. `parse_number` reads only `.`, so a comma only ever reaches
    # `original.raw` when the tokenizer's own alt-separator retry put it there
    # (`_parse_value` above) — which happens only for a profile that declares one. A value
    # with no `original` (nothing to keep the style of) is written with the point, as it
    # always was. Mirrors `formatNumber` in `core/nc/numberFormat.ts`.
    separator = "," if original is not None and "," in original.raw else "."

    return "%s%s%s%s" % (sign, integer, separator if point else "", fraction)


def _decimal_text(literal: NumericLiteral) -> str:
    """``literal`` as text ``Decimal()`` accepts: always a point, whatever it was written
    with. ``scale_decimal`` sees `raw` text a tokenizer already accepted as a number —
    Klartext's decimal comma included (§7.16 / R4) — and `Decimal("1000,5")` raises, so the
    arithmetic is built from the parsed parts instead of the written text.
    """
    frac = literal.frac_part or ""
    return "%s%s%s" % (literal.sign, literal.int_part or "0", ("." + frac) if literal.has_point else "")


def _lenient_number(raw: str) -> Optional[NumericLiteral]:
    """``parse_number``, plus a comma retried as the point when the strict parse fails.

    ``scale_decimal`` has no profile to read `syntax.decimalSeparatorAlt` from — its
    signature is pinned (plan §7.10) — so it reads the one comma that can ever reach it:
    ``scale_feed``/``scale_speed`` pass a token's own `value.raw`, and the only dialect
    whose tokenizer ever puts a comma there is Klartext (`_parse_value` above). A comma
    here is that decimal comma, never a thousands separator or a stray character.
    """
    value = parse_number(raw)
    if value is not None or "," not in raw:
        return value
    alt = parse_number(raw.replace(",", "."))
    return None if alt is None else replace(alt, raw=raw)


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
    left = _lenient_number(raw.strip() if isinstance(raw, str) else "")
    right = _lenient_number(str(percent).strip())
    if left is None:
        raise ValueError("scale_decimal: not a decimal number: %r" % (raw,))
    if right is None:
        raise ValueError("scale_decimal: not a percentage: %r" % (percent,))

    with localcontext() as context:
        # Enough digits that the product is exact: the two operands' digits plus the two
        # the division by a hundred shifts, and a wide margin on top.
        context.prec = len(left.raw) + len(right.raw) + 20
        product = Decimal(_decimal_text(left)) * Decimal(_decimal_text(right))
        scaled = product.scaleb(-2)
    text = format(scaled, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def decimal_of(number: Any) -> Optional[Decimal]:
    """The exact value of a written number as a :class:`~decimal.Decimal`, or ``None``.

    ``number`` is a :class:`NumericLiteral` (a token's ``value``) or the text of one (what
    :func:`format_number` wrote). ``Decimal(literal.raw)`` is **not** the same thing: a
    Klartext decimal comma stays in ``raw`` (`F500,5`, §7.16 #34) so that a rewrite writes
    it back, and ``Decimal("500,5")`` raises. The value is built from the parsed parts
    instead, the way :func:`scale_decimal` does it; text is read by the same lenient rule
    (a strict parse, then the comma retried as the point). ``None`` for anything that is
    not a number.
    """
    if isinstance(number, NumericLiteral):
        literal: Optional[NumericLiteral] = number
    elif isinstance(number, str):
        literal = _lenient_number(number.strip())
    else:
        literal = None
    if literal is None:
        return None
    return Decimal(_decimal_text(literal))


# ---------------------------------------------------------------------------
# Codes and modal state
# ---------------------------------------------------------------------------

_CODE_SPACE = re.compile(r"\s+", re.ASCII)
_CODE_JOIN = re.compile(r"^([A-Z]) (?=[-+.]?\d)", re.ASCII)
_CODE_PAD = re.compile(r"^([A-Z]+)0+(?=\d)", re.ASCII)


@lru_cache(maxsize=32768)
def normalize_code(code: str) -> str:
    """The canonical form of a written code: ``G01`` → ``G1``, ``cycl  def 200`` → ``CYCL DEF 200``.

    Mirrors ``normalizeCode`` in ``src/lib/core/codes/lookup.ts``: case is ignored, zero
    padding is dropped, a decimal part is kept (``G54.1``), whitespace inside a multi-word
    code collapses to one space, and a single address letter written apart from its digits
    joins up (``G 83`` → ``G83``, while ``CALL LBL`` keeps its space).

    Remembered per written form: every word of every block asks (``G1``, ``M3``, ``X0.5``),
    a program repeats the same few hundred spellings, and the answer is a pure function of
    the text. The cache is bounded, so a program of distinct coordinates cannot grow it.
    """
    packed = _CODE_SPACE.sub(" ", code.upper().strip())
    return _CODE_PAD.sub(r"\1", _CODE_JOIN.sub(r"\1", packed))
