#!/usr/bin/env python3
# /// gedit
# name = "Extents"
# description = "The smallest and largest value of every axis, for the whole program, per work offset and per tool, with arc extremes. A value the script cannot be sure of is counted as not resolved, never guessed."
# input = "selection-or-document"
# output = "report"
# timeout = 300
# ///
"""The extents of a program (plan §6 M10 WP10.3; `nc-transformations.md`, "Extents").

The smallest and largest value of every axis — for the whole program, per work offset and
per tool inside it — so a wrong depth or a stray coordinate shows up without a backplot.
The report format is ``tests/fixtures/scripts/extents/README.md``; this docstring says how
the values are found.

**Effective values only.** Every word goes through ``gedit_nc.number_class_of`` and
``gedit_nc.resolve_value``: ``Z1000`` is 1 mm on an IS-B machine and 1000 mm on a calculator
one, and with no machine chosen a word the profile's presets read differently has no value
at all (AD-31, D57). Such a word is **not resolved**: it is counted in its row and named in
a finding, never put into a range with an assumed reading. So is everything else the script
cannot be sure of — a variable, a position inside a coordinate frame, an incremental word
whose start is not known, a cycle whose positions are its parameters. A range is a claim,
and an honest "not resolved" is worth more than a confident wrong minimum.

**What the data decides** (roadmap R3; no list of machine codes in this file):

* a code with ``axisWords: 'machine'`` (``G28``, ``G53``, ``M91``, ``SUPA``) makes its block a
  machine position: listed in rows of its own, never in a range, and the axes it moved are
  in an unknown place of the program's frame afterwards;
* ``axisWords: 'data'`` / ``wordsAreData`` (``G92``, ``G52``, ``G10``, ``CYCL DEF 7``,
  ``TRANS``, a dwell's ``X``) — values, not positions: left out, one ``info`` per code; a
  code with ``pole: 'set'`` is the **pole** (Klartext ``CC``), the centre of the arcs and
  polar moves after it; a code with ``shift`` (``G52``, ``G92``, ``TRANS``) starts a group
  of its own, ``G54 + G52 (line 8)``, because the positions after it are in another system;
* a linear position written while a rotary axis that turns it (ISO 841) stands turned, or
  at an angle not known, and tool centre point control is off is a position of the
  machine's axes, not of the workpiece: not resolved (``gedit_nc.RotaryState``, which address
  arithmetic reads too);
* a cycle start whose words are data (the Fanuc lathe ``G71``–``G73``): the control
  computes its passes, so they are not resolved;
* a code of the ``offset`` group (``G54``–``G59``, ``CYCL DEF 247``) starts a work-offset
  group; the modal ``frame`` (§7.4 rule 13) makes a position not resolved; tool centre point
  control (``tcp``, rule 14) does not: under it ``X``/``Y``/``Z`` are the tool tip;
* incremental words: the distance mode (``sets.distance``), the profile's
  ``addresses.incremental`` (R6's ``U``/``W`` choice, on the effective profile) and the
  Klartext ``I`` prefix; the plane (``sets.plane``, Klartext's tool axis, rule 15).

**One X column, in diameter values** on a turning profile (``addresses.diameter``): each
word is read by ``ModalInterpreter.diameter_reading`` (AD-19 rule 11), and a radius word —
``DIAMOF``, or ``DIAM90`` under incremental distance — counts double, so a program that
switches never mixes the two in one range. A milling profile that lists diameter words
(``sinumerik-mill``) keeps a plain ``X`` column, and a diameter word there counts half.

**The geometry vocabulary.** The code database says nothing about circles yet, so the few
names the arcs need stand in one table below (:data:`ARC_CODES` and the words after it):
the ISO meaning of ``G2``/``G3`` that every shipped G-code dialect shares, and the
direction, radius and polar words of the dialects that write arcs without a G code. It is
the one place this script names codes; a database flag can replace it.

A run over a **selection** is primed from ``input.precedingLines`` (modal state *and*
positions), so an incremental move or an arc right at the top of the selection starts where
the program really is; without the field it starts from the power-on state and says so.

Standard library only, Python 3.9 and newer, like every bundled script. It never changes
the document.
"""

from __future__ import annotations

import math
import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc

TITLE = "Extents"

COLUMNS = [
    {"key": "where", "label": "Where"},
    {"key": "axis", "label": "Axis"},
    {"key": "min", "label": "Min"},
    {"key": "minLine", "label": "At line"},
    {"key": "max", "label": "Max"},
    {"key": "maxLine", "label": "At line"},
    {"key": "unresolved", "label": "Not resolved"},
]

# ---------------------------------------------------------------------------
# The geometry vocabulary (see the module docstring)
# ---------------------------------------------------------------------------

#: ISO circular interpolation: the canonical motion code -> its direction. ``G02`` and
#: ``G03`` normalize to these (``gedit_nc.normalize_code``).
ARC_CODES = {"G2": "cw", "G3": "ccw"}
#: The arc centre words by the axis they offset (ISO; the profile's ``addresses.arcCenter``
#: says which of them a dialect writes, ``arcCenterMode`` how).
CENTRE_AXIS = {"I": "X", "J": "Y", "K": "Z"}
#: The words that give an arc by its radius (ISO ``R``, Sinumerik ``CR=``, Klartext ``CR … R``).
RADIUS_WORDS = ("R", "CR")
#: Klartext's direction word: ``DR+`` counter-clockwise, ``DR-`` clockwise.
DIRECTION_WORD = "DR"
#: Klartext's polar words: the radius and the angle about the pole.
POLAR_RADIUS = "PR"
POLAR_ANGLE = "PA"
#: Arcs the script cannot compute: tangential ones (Klartext ``CT``, ``CTP``, Sinumerik
#: ``CT``) and one through an intermediate point (Sinumerik ``CIP``). Their end points are in
#: the ranges; their bulge is not resolved.
UNRESOLVED_ARCS = ("CT", "CTP", "CIP")
#: Sinumerik's number of extra full turns of a helix (``TURN=2``).
TURNS_WORD = "TURN"
#: Sinumerik's value functions: ``X=AC(10)`` is absolute and ``X=IC(2)`` incremental whatever
#: the distance mode says, and a CAM post writes its arc centres as ``J=AC(8.381)``. Only a
#: plain number inside is read; anything else stays an expression.
VALUE_FUNCTIONS = {"AC": "absolute", "IC": "incremental"}

#: A plane -> its first and second axis. Positive angles turn from the first to the second,
#: which is counter-clockwise seen from the positive third axis (``G3`` / ``DR+``).
PLANE_AXES = {"XY": ("X", "Y"), "ZX": ("Z", "X"), "YZ": ("Y", "Z")}
#: A plane -> the axis normal to it, the tool axis of a drilling plane.
PLANE_NORMAL = {"XY": "Z", "ZX": "Y", "YZ": "X"}

#: How far an arc's radius may fall short of half its chord before the arc counts as one the
#: control would refuse (a post rounds both end points), in the program's units.
CHORD_SLACK = Decimal("0.002")
#: Decimals a range value is written with, by kind: millimetres and degrees, inches.
DECIMALS = {"mm": 4, "inch": 5, "angle": 4}
#: One inch in millimetres, exactly.
INCH = Decimal("25.4")

_ZERO = Decimal(0)
_TWO = Decimal(2)


def literal_of(token: gedit_nc.Token) -> Tuple[Any, Optional[str]]:
    """The number a word is written with, and ``'absolute'``/``'incremental'`` when a value
    function (:data:`VALUE_FUNCTIONS`) says so; ``(None, None)`` for an expression."""
    if token.value is not None:
        return token.value, None
    text = (token.value_text or "").strip()
    open_at = text.find("(")
    if open_at <= 0 or not text.endswith(")"):
        return None, None
    mode = VALUE_FUNCTIONS.get(text[:open_at].strip().upper())
    literal = gedit_nc.parse_number(text[open_at + 1 : -1].strip()) if mode is not None else None
    return (literal, mode) if literal is not None else (None, None)


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — profiles arrive as JSON."""
    return value if isinstance(value, dict) else {}


def upper_list(value: Any) -> List[str]:
    """A profile list of addresses, upper-cased; anything else is an empty list."""
    return [str(item).upper() for item in value if isinstance(item, str)] if isinstance(value, list) else []


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------


def dec(text: Optional[str]) -> Optional[Decimal]:
    """A decimal string as a :class:`Decimal`, or ``None``."""
    if text is None:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


#: Decimals a computed coordinate (a radius, a polar point) is carried with: a nanometre,
#: far below what a range shows, and coarse enough that a quarter of a circle computed
#: twice lands on the same number.
COMPUTED = 6


def sqrt(value: Decimal) -> Decimal:
    """The square root, with digits to spare."""
    with localcontext() as context:
        context.prec = 34
        return value.sqrt()


def distance(da: Decimal, db: Decimal) -> Decimal:
    """The length of a vector, to :data:`COMPUTED` decimals."""
    return rounded(sqrt(da * da + db * db), COMPUTED)


def rounded(value: Decimal, places: int) -> Decimal:
    """``value`` rounded half away from zero to ``places`` decimals."""
    with localcontext() as context:
        context.prec = 60
        return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def text_of(value: Decimal, places: int) -> str:
    """How a range value is written: rounded, no trailing zeros, no ``-0``."""
    out = rounded(value, places)
    if out == _ZERO:
        return "0"
    text = format(out.normalize(), "f")
    return text


def angle_of(dy: Decimal, dx: Decimal) -> float:
    """The angle of a vector in degrees, ``0 <= a < 360`` (floats only decide *which* side)."""
    a = math.degrees(math.atan2(float(dy), float(dx)))
    return a + 360.0 if a < 0 else a


def polar_point(radius: Decimal, degrees: Decimal) -> Tuple[Decimal, Decimal]:
    """``(r·cos a, r·sin a)``, exact on the quarter turns and to 1e-6 elsewhere."""
    quarter = degrees / Decimal(90)
    if quarter == quarter.to_integral_value():
        k = int(quarter) % 4
        return [(radius, _ZERO), (_ZERO, radius), (-radius, _ZERO), (_ZERO, -radius)][k]
    a = math.radians(float(degrees))
    return (
        rounded(radius * Decimal(repr(math.cos(a))), COMPUTED),
        rounded(radius * Decimal(repr(math.sin(a))), COMPUTED),
    )


# ---------------------------------------------------------------------------
# The ranges
# ---------------------------------------------------------------------------


class Range:
    """The smallest and the largest value of one axis in one scope, and what was not resolved."""

    __slots__ = ("low", "low_line", "high", "high_line", "unresolved", "first_unresolved")

    def __init__(self) -> None:
        self.low: Optional[Decimal] = None
        self.low_line = 0
        self.high: Optional[Decimal] = None
        self.high_line = 0
        self.unresolved = 0
        self.first_unresolved = 0

    def add(self, value: Decimal, line: int) -> None:
        # The first line that reached the value: a later line with the same value keeps it.
        # (A position held back until the end of the walk, `Extents.held`, comes in late, so
        # an equal value from an earlier line still wins.)
        if self.low is None or value < self.low or (value == self.low and line < self.low_line):
            self.low, self.low_line = value, line
        if self.high is None or value > self.high or (value == self.high and line < self.high_line):
            self.high, self.high_line = value, line

    def miss(self, line: int) -> None:
        self.unresolved += 1
        if self.first_unresolved == 0 or line < self.first_unresolved:
            self.first_unresolved = line


class Scope:
    """One block of rows: the program, a work-offset group, a tool inside it."""

    def __init__(self, kind: str, where: str) -> None:
        self.kind = kind
        self.where = where
        self.ranges: Dict[str, Range] = {}

    def range(self, axis: str) -> Range:
        found = self.ranges.get(axis)
        if found is None:
            found = Range()
            self.ranges[axis] = found
        return found

    def empty(self) -> bool:
        return not self.ranges


class Group:
    """A work-offset group and the tools that cut in it, in order of first use."""

    def __init__(self, code: Optional[str], line: int, label: str) -> None:
        self.code = code
        self.line = line
        self.scope = Scope("offset", label)
        self.label = label
        self.tools: Dict[str, Scope] = {}
        self.order: List[str] = []
        self.positions = False
        #: The work offset a shifted group is in (`G54`, or "No work offset").
        self.base = label.split(" (line")[0]


# ---------------------------------------------------------------------------
# What the profile says about the axes
# ---------------------------------------------------------------------------


class Axes:
    """The profile's axes, incremental twins, rotary axes and diameter words."""

    def __init__(self, profile: Dict[str, Any]) -> None:
        addresses = as_dict(profile.get("addresses"))
        self.twins = gedit_nc.incremental_axes(profile)
        listed = upper_list(addresses.get("axes"))
        #: The axes a row can be about, in the profile's order. A twin moves an axis; it is
        #: not one (the Fanuc lathe lists `U`/`W` under `axes` *and* as twins).
        self.order = [axis for axis in listed if axis not in self.twins]
        for axis in self.twins.values():
            if axis not in self.order:
                self.order.append(axis)
        self.known = frozenset(self.order)
        self.angular = frozenset(upper_list(addresses.get("angular")))
        self.diameter_words = frozenset(gedit_nc.diameter_axes(profile))
        #: A turning profile shows X as a diameter; a milling one keeps the coordinate.
        self.lathe_column = gedit_nc.machine_type_of(profile) == "lathe" and "X" in self.diameter_words
        centre = upper_list(addresses.get("arcCenter"))
        self.centre_words = frozenset(word for word in centre if word in CENTRE_AXIS)
        self.centre_incremental = addresses.get("arcCenterMode") != "absolute"

    def axis_of(self, address: str) -> Optional[str]:
        """The axis a word moves, or ``None`` for a word that is no axis."""
        if address in self.twins:
            return self.twins[address]
        return address if address in self.known else None

    def label(self, axis: str) -> str:
        return "X (diameter)" if axis == "X" and self.lathe_column else axis

    def geo(self, axis: str, value: Decimal) -> Decimal:
        """A column value as a coordinate: a diameter column holds twice the radius."""
        return value / _TWO if axis == "X" and self.lathe_column else value

    def col(self, axis: str, value: Decimal) -> Decimal:
        """A coordinate as a column value."""
        return value * _TWO if axis == "X" and self.lathe_column else value


# ---------------------------------------------------------------------------
# What the program could not tell us
# ---------------------------------------------------------------------------

#: Kind -> (severity, the sentence after the count). The order is the order of the findings
#: for one line; the ids are what a test counts (`reason`, ignored by the app).
KINDS = {
    "machine-dependent": "warning",
    "expression": "warning",
    "distance-unknown": "warning",
    "diameter-unknown": "warning",
    "incremental-start": "warning",
    "called-program": "warning",
    "frame": "warning",
    "unknown-code": "warning",
    "multi-pass": "warning",
    "cycle": "warning",
    "cycle-position": "warning",
    "arc": "warning",
    "polar": "warning",
    "rotary": "warning",
    "data": "info",
    "selection": "info",
}


class Findings:
    """One finding per kind (and per code where the code is the news), counted."""

    def __init__(self) -> None:
        self.found: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add(self, kind: str, line: int, detail: str = "", key: str = "", **extra: Any) -> None:
        slot = self.found.get((kind, key))
        if slot is None:
            slot = {"kind": kind, "line": line, "count": 0, "detail": detail, "key": key}
            slot.update(extra)
            self.found[(kind, key)] = slot
        elif line < slot["line"]:
            # A held-back position (`Extents.held`) is counted at the end of the walk.
            slot.update({"line": line, "detail": detail})
            slot.update(extra)
        slot["count"] += 1

    def out(self) -> List[Dict[str, Any]]:
        rows = sorted(self.found.values(), key=lambda s: (s["line"], list(KINDS).index(s["kind"]), s["key"]))
        return [
            {"line": s["line"], "severity": KINDS[s["kind"]], "message": message_of(s), "reason": s["kind"]}
            for s in rows
        ]


def times(count: int, one: str, many: str) -> str:
    return ("1 " + one) if count == 1 else ("%d %s" % (count, many))


def message_of(s: Dict[str, Any]) -> str:
    """The sentence of one finding (our words; the goldens pin them)."""
    kind, count, detail = s["kind"], s["count"], s["detail"]
    if kind == "machine-dependent":
        readings = s.get("readings") or ""
        if callable(readings):
            readings = readings()
        return (
            "%s, first %s: the value depends on how the machine reads a number%s. Not "
            "resolved; choose a machine for this document to read them."
            % (times(count, "word", "words"), detail, (" (" + readings + ")") if readings else "")
        )
    if kind == "expression":
        return "%s written as a variable or an expression, first %s: not resolved." % (
            times(count, "word", "words"),
            detail,
        )
    if kind == "distance-unknown":
        return (
            "%s, first %s, before the program says whether positions are absolute or "
            "incremental: not resolved." % (times(count, "word", "words"), detail)
        )
    if kind == "diameter-unknown":
        return (
            "%s, first %s, where it is not known whether X is a diameter or a radius "
            "(an absolute-only diameter mode before the distance mode is known): not resolved."
            % (times(count, "word", "words"), detail)
        )
    if kind == "incremental-start":
        return (
            "%s, first %s, move from a position the program does not state (the start, or "
            "after a machine position, a cycle, a frame or a value that was not resolved): "
            "not resolved." % (times(count, "incremental word", "incremental words"), detail)
        )
    if kind == "called-program":
        return (
            "%s, first %s, in %s before it states the axis: a called program moves from "
            "where the program that calls it left the tool, which the file does not say, so "
            "they are not resolved." % (times(count, "incremental word", "incremental words"), detail, s["key"])
        )
    if kind == "frame":
        return (
            "%s inside the coordinate frame of %s: they are in that frame's coordinates, "
            "not the program's, so they are not resolved." % (times(count, "position", "positions"), detail)
        )
    if kind == "unknown-code":
        return (
            "%s: a code the code database does not know, in %s; the %s of %s are not "
            "resolved, because the code may move them outside the program's frame."
            % (detail, times(count, "block", "blocks"), "positions", "those blocks")
        )
    if kind == "multi-pass":
        return (
            "%s, %s: the control computes the passes of this cycle from its values; the "
            "start point and the profile are in the ranges, the passes are not resolved."
            % (detail, times(count, "block", "blocks"))
        )
    if kind == "cycle":
        return (
            "%s, run in %s: the positions this cycle works to are in its parameters, which "
            "the extents do not compute; they are not resolved (its depth is not in the %s "
            "range)." % (detail, times(count, "block", "blocks"), s.get("names") or "tool-axis")
        )
    if kind == "cycle-position":
        return (
            "%s, %s: its axis words are positions of the cycle it calls, not of the tool, so "
            "they are not resolved." % (detail, times(count, "block", "blocks"))
        )
    if kind == "arc":
        return (
            "%s, first %s, whose centre or plane is not known: the end points are in the "
            "ranges, the arc between them is not resolved." % (times(count, "arc", "arcs"), detail)
        )
    if kind == "polar":
        return (
            "%s, first %s, that cannot be resolved from the pole (no pole, no radius or "
            "angle to start from, or a value that was not resolved)." % (times(count, "polar move", "polar moves"), detail)
        )
    if kind == "rotary":
        return (
            "%s, first %s, written while %s stood turned (or at an angle that is not known) and "
            "tool centre point control was off: they are positions of the machine's axes, not "
            "of the workpiece, so they are not resolved." % (times(count, "position", "positions"), detail, s.get("names") or "a rotary axis")
        )
    if kind == "data":
        return "%s, %s: its axis words are values, not positions; left out of the ranges." % (
            detail,
            times(count, "block", "blocks"),
        )
    if kind == "selection":
        return (
            "The lines above the selection were not sent, so this run starts from the "
            "power-on state: a position or a mode set above it is not known here."
        )
    return detail  # pragma: no cover - every kind is above


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------


class Written:
    """The codes one line writes, as the interpreter reads them (§7.4)."""

    __slots__ = ("entries", "words", "calls")

    def __init__(self) -> None:
        #: (database entry, canonical code, token kind)
        self.entries: List[Tuple[Dict[str, Any], str, str]] = []
        #: unknown word codes under the database's motion letter (`G123`)
        self.words: List[str] = []
        self.calls: List[Any] = []


class Extents:
    """Walks a program and collects its ranges."""

    def __init__(self, context: Dict[str, Any], cp: gedit_nc.CompiledProfile) -> None:
        self.profile = as_dict(context.get("profile"))
        self.cp = cp
        self.codes = context.get("codes") if isinstance(context.get("codes"), list) else []
        self.interp = gedit_nc.ModalInterpreter(cp, self.codes)
        self.machine = gedit_nc.machine_params(context)
        self.axes = Axes(self.profile)
        self.findings = Findings()
        #: Caches for the two questions every word asks (`value`).
        self._classes: Dict[Any, Optional[str]] = {}
        self._readings: Dict[Any, Tuple[Optional[str], List[Dict[str, Any]]]] = {}

        #: The address letters the database writes its motion codes with (`G`): a word under
        #: one of them that the database lacks may be a machine position (R3) or a frame.
        self.code_heads = frozenset(
            head_of(e.get("code"))
            for e in self.codes
            if isinstance(e, dict) and e.get("group") == "motion" and is_word_code(e.get("code"))
        )

        #: The letters any code of the database starts with: only a word under one of them
        #: can be a code, which spares a lookup for every axis word.
        self.all_heads = frozenset(head_of(e.get("code")) for e in self.codes if isinstance(e, dict))
        for e in self.codes:
            for alias in (e.get("aliases") or []) if isinstance(e, dict) else []:
                self.all_heads = self.all_heads | {head_of(alias)}
        #: The position of every axis, in column values, or `None` while it is not known.
        self.pos: Dict[str, Optional[Decimal]] = {axis: None for axis in self.axes.order}
        #: The pole (Klartext `CC`), by axis, and the last polar radius and angle about it.
        self.pole: Dict[str, Decimal] = {}
        self.last_polar: Optional[Tuple[Decimal, Decimal]] = None

        self.program = Scope("program", "Program")
        self.groups: List[Group] = []
        self.offset_codes = 0
        self.machine_rows: List[Dict[str, Any]] = []
        self.record = False
        self.report_units: Optional[str] = None
        self.units_switched = False
        self.diameter_start: Optional[Dict[str, Any]] = None
        self.diameter_switches: List[Tuple[str, int]] = []
        #: M10 review (NC-10): where the rotary axes stand while nothing compensates them, the
        #: linear axes the current block's turned rotary axes take out of the ranges, and the
        #: positions held back until the walk shows whether an unwritten rotary axis is ever
        #: written: (scopes, axis, value, line, the unwritten axes).
        self.rotary = gedit_nc.RotaryState(self.profile)
        self.tilt: Dict[str, Tuple[frozenset, frozenset]] = {}
        self._tilts: Dict[Any, Dict[str, Tuple[frozenset, frozenset]]] = {}
        self.held: List[Tuple[List[Scope], str, Decimal, int, frozenset]] = []
        self._tilt_missed: set = set()
        self.linear_axes = [axis for axis in self.axes.order if axis not in self.axes.angular]
        #: M10 review (NC-7): the coordinate shift in force (`G52 (line 8)`), if any.
        self.shift: Optional[str] = None
        #: M13 review (NC-4): the program after the first one the walk is in (`O2 (line 14)`),
        #: and the axes it has not stated yet: it starts where its caller left the tool.
        self.called: Optional[str] = None
        self.unstated: set = set()
        #: M13 review (NC-9): the tool word of each tool line, as written (`T010101`).
        self.tool_words: Dict[int, str] = {}
        tool_list = as_dict(self.profile.get("toolList"))
        self.drop_leading_zeros = tool_list.get("dropLeadingZeros") is True
        self.collapse_offset_digits = tool_list.get("collapseOffsetDigits") is True

    # -- scopes ---------------------------------------------------------------

    def group(self) -> Group:
        if not self.groups:
            self.groups.append(Group(None, 0, "No work offset"))
        return self.groups[-1]

    def change_offset(self, code: str, line: int, has_values: bool) -> None:
        """A code of the `offset` group: a new group when it changes the offset."""
        self.offset_codes += 1
        current = self.groups[-1] if self.groups else None
        if current is not None and current.code == code and not (has_values and current.positions):
            return
        if current is not None and not current.positions and current.scope.empty():
            # Nothing was measured in the group it replaces: drop it rather than list an
            # empty group (`G54` written twice before the first move).
            self.groups.pop()
        self.groups.append(Group(code, line, "%s (line %d)" % (code, line)))

    def shift_group(self, code: str, line: int) -> None:
        """NC-7: a code that shifts or sets the coordinate system (`CodeEntry.shift`): the
        positions after it are in another system than those before, so a group of their own,
        named after the work offset it is in (`G54 + G52 (line 8)`)."""
        self.offset_codes += 1
        current = self.group()
        base = current.base
        if not current.positions and current.scope.empty() and current.code is not None:
            self.groups.pop()
        group = Group(current.code, line, "%s + %s (line %d)" % (base, code, line))
        group.base = base
        self.groups.append(group)

    def tool_scope(self) -> Optional[Scope]:
        tool = self.interp.tool
        if tool is None:
            return None
        station = str(tool.get("station") or tool.get("written") or "")
        group = self.group()
        scope = group.tools.get(station)
        if scope is None:
            written = str(tool.get("written") or station).strip()
            line = tool.get("line") if isinstance(tool.get("line"), int) else 0
            # M13 review (NC-9): the tool as the tool list and the map name it, and the word
            # as written when that says more (`T1 (T010101, line 9)`).
            label = gedit_nc.tool_label(str(tool.get("station") or written), self.drop_leading_zeros, self.collapse_offset_digits)
            word = self.tool_words.get(line, written)
            if label == "":
                label = word
            scope = Scope("tool", "%s (line %d)" % (label, line) if word == label else "%s (%s, line %d)" % (label, word, line))
            group.tools[station] = scope
            group.order.append(station)
        return scope

    def scopes(self) -> List[Scope]:
        group = self.group()
        out = [self.program, group.scope]
        tool = self.tool_scope()
        if tool is not None:
            out.append(tool)
        return out

    def note(self, axis: str, value: Decimal, line: int) -> None:
        if not self.record:
            return
        tilt = self.tilt.get(axis)
        if tilt is not None:
            turned, unwritten = tilt
            if turned:
                if (axis, line) not in self._tilt_missed:
                    self._tilt_missed.add((axis, line))
                    names = " and ".join(sorted(turned))
                    self.miss(axis, line, "rotary", "%s (line %d)" % (axis, line), key=names, names=names)
                return
            if unwritten:
                self.group().positions = True
                self.held.append((self.scopes(), axis, value, line, unwritten))
                return
        self.group().positions = True
        for scope in self.scopes():
            scope.range(axis).add(value, line)

    def settle_held(self) -> None:
        """NC-10: a position written before a rotary axis that turns it was first written, to
        anything but zero, is not resolved after all (where that axis stood is not known); the
        others go into their ranges now."""
        for scopes, axis, value, line, unwritten in self.held:
            later = self.rotary.known_later(unwritten)
            if not later:
                for scope in scopes:
                    scope.range(axis).add(value, line)
                continue
            for scope in scopes:
                scope.range(axis).miss(line)
            names = " and ".join(later)
            self.findings.add("rotary", line, "%s (line %d)" % (axis, line), key=names, names=names)
        self.held = []

    def track_rotary(self, moves, entries, state, line: int) -> None:
        """NC-10: the rotary axes after this block, and the linear axes they take out of the
        ranges while tool centre point control is off and no frame is open."""
        rotary = self.rotary
        before = rotary.state
        words = []
        distance = state["distance"]
        for axis, token in moves:
            if axis not in rotary.rotary:
                continue
            literal, function = literal_of(token)
            address = token.address.upper()
            if address in rotary.twins or token.incremental or function == "incremental":
                incremental: Optional[bool] = True
            elif function == "absolute" or distance == "absolute":
                incremental = False
            elif distance == "incremental":
                incremental = True
            else:
                incremental = None
            words.append((address, literal, incremental))
        flags = [gedit_nc.axis_words_of(e) for e in entries]
        if words and "data" not in flags:
            # A data block's words (a macro call's `A1.`) move no axis; a machine position
            # moves it to a place the program's frame does not state.
            before = dict(before)
            rotary.update(words, line, "machine" in flags)
        if self.interp.tcp is not None or self.interp.frame is not None:
            self.tilt = {}
            return
        after = rotary.state
        key = (tuple(sorted(before.items())), tuple(sorted(after.items())))
        found = self._tilts.get(key)
        if found is None:
            found = {}
            for axis in self.linear_axes:
                turned, unwritten = rotary.blocking(axis, before, after)
                if turned or unwritten:
                    found[axis] = (turned, unwritten)
            self._tilts[key] = found
        self.tilt = found

    def miss(self, axis: str, line: int, kind: str, detail: str = "", key: str = "", **extra: Any) -> None:
        """One position of one axis that is not resolved, and the finding that says why."""
        self.miss_axes([axis], line, kind, detail, key, **extra)

    def miss_axes(self, axes: Sequence[str], line: int, kind: str, detail: str = "", key: str = "", **extra: Any) -> None:
        """One thing that left a position of each of ``axes`` not resolved: one finding."""
        if not self.record:
            return
        axes = [axis for axis in axes if axis in self.axes.known]
        if axes:
            self.group().positions = True
            for scope in self.scopes():
                for axis in axes:
                    scope.range(axis).miss(line)
        self.findings.add(kind, line, detail, key, **extra)

    # -- one line -------------------------------------------------------------

    def line(self, line: str, number: int, state: Optional[gedit_nc.LineState], record: bool) -> Optional[gedit_nc.LineState]:
        cp = self.cp
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        if record and self.diameter_start is None:
            # The mode the run starts in: before its first line, which may switch it.
            diameter = self.interp.state["diameter"]
            self.diameter_start = dict(diameter) if diameter is not None else {}
        masked = gedit_nc.mask_comments(line, cp)
        start = gedit_nc.program_start_of(line, cp)
        if start is not None and self.interp.program_start(number):
            # M13 review (NC-4): a program after the first (a subprogram behind `M30`) runs
            # with the tool and from the position its caller left, which the file does not
            # say: no tool scope until its own tool call, and no axis until it states it.
            self.forget_all()
            self.called = "%s (line %d)" % (start, number)
            self.unstated = set(self.axes.order)
        self.interp.update(tokens, number, masked)
        tool = self.interp.tool
        if tool is not None and tool.get("line") == number:
            self.tool_words[number] = self.tool_word(tokens, masked, tool)
        self.record = record
        self.block(tokens, number)
        return state

    def tool_word(self, tokens: Sequence[gedit_nc.Token], masked: str, tool: Dict[str, Any]) -> str:
        """NC-9: the word of a tool line that names the tool (`T010101`, `T="ROUGH"`), or the
        text the profile's pattern matched when no word of an address does (`TOOL CALL 1 Z`)."""
        written = str(tool.get("written") or "").strip()
        station = str(tool.get("station") or "")
        at = masked.find(written) if written else -1
        if at >= 0 and station:
            for token in tokens:
                if token.kind != "word" or not token.address or token.start >= at + len(written) or token.end <= at:
                    continue
                if station in token.text:
                    return token.text.strip()
        return written

    def written(self, tokens: Sequence[gedit_nc.Token]) -> Written:
        """The database entries of the codes a line writes (the interpreter's reading)."""
        out = Written()
        interp = self.interp
        count = len(tokens)
        for i, token in enumerate(tokens):
            kind = token.kind
            if kind == "word":
                address = (token.address or "").upper()
                if address == "" or gedit_nc.is_assignment(token):
                    continue
                if address not in self.all_heads:
                    continue  # no code of the database starts with this letter (`X`, `Y`)
                code = address + (token.value_text or "")
                entry = interp.entry(code)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, code), kind))
                elif address in self.code_heads and token.value is not None:
                    out.words.append(token.text)
            elif kind == "call":
                entry = interp.entry(token.address or "")
                out.calls.append(token)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, token.address or ""), kind))
            elif kind == "keyword":
                name = token.address or token.text
                number = token.value_text
                if number is None:
                    nxt = next((t for t in tokens[i + 1 : count] if t.kind != "whitespace"), None)
                    if nxt is not None and nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                entry = None
                if number is not None:
                    entry = interp.entry("%s %s" % (name, number))
                    whole, dot, part = number.partition(".")
                    if entry is None and dot == "." and whole.isdigit():
                        entry = interp.entry("%s %s" % (name, whole))
                if entry is None:
                    entry = interp.entry(name)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, name), kind))
        return out

    def block(self, tokens: Sequence[gedit_nc.Token], line: int) -> None:
        interp = self.interp
        written = self.written(tokens)
        entries = [e for e, _, _ in written.entries]
        axes = self.axes

        # The words that move an axis, in written order.
        moves: List[Tuple[str, gedit_nc.Token]] = []
        words: Dict[str, gedit_nc.Token] = {}
        for token in tokens:
            if token.kind != "word" or not token.address:
                continue
            address = token.address.upper()
            if token.index is not None:
                continue
            words[address] = token
            axis = axes.axis_of(address)
            if axis is not None and (token.value_text or "") != "":
                moves.append((axis, token))

        for entry, code, _ in written.entries:
            sets = as_dict(entry.get("sets"))
            if sets.get("diameter") in ("on", "off", "absolute-only") and self.record:
                self.diameter_switches.append((code, line))

        # Work offsets come first: the block's own positions are in the new offset.
        for entry, code, _ in written.entries:
            if entry.get("group") == "offset":
                self.change_offset(code, line, bool(moves) and gedit_nc.axis_words_of(entry) == "data")
            elif entry.get("shift") is True and self.record and (moves or self.bare(tokens, written)):
                self.shift_group(code, line)

        if not moves and not written.calls and not entries:
            return
        state = interp.state
        if self.rotary.rotary:
            self.track_rotary(moves, entries, state, line)
        units = state["units"]["value"]
        if units in ("mm", "inch") and self.report_units is None and self.record:
            self.report_units = units
        elif units in ("mm", "inch") and self.record and units != self.report_units:
            self.units_switched = True

        flags = [(gedit_nc.axis_words_of(e), e, code) for e, code, _ in written.entries]
        machine = next(((e, c) for f, e, c in flags if f == "machine"), None)
        multipass = next(
            ((e, c) for f, e, c in flags if f == "data" and as_dict(e.get("sets")).get("cycle") == "start"),
            None,
        )
        data = [(e, c) for f, e, c in flags if f == "data"]
        plane = state["plane"]

        if machine is not None:
            self.machine_block(machine[1], moves, line, units, entries)
            return
        if multipass is not None:
            self.miss_axes(self.plane_axes(plane), line, "multi-pass", multipass[1], key=multipass[1])
            return
        if data:
            pole = next(((e, c) for e, c in data if e.get("pole") == "set"), None)
            if pole is not None:
                self.set_pole(moves, line, units, entries, plane)
                return
            if moves and self.record:
                self.findings.add("data", line, data[0][1], key=data[0][1])
            # A shift, a coordinate set or a macro call: where the tool stands in the new
            # coordinates is not something the extents compute. A word the code declares as a
            # value of another kind (a dwell's `X`, `unit: 'dwell'`) moves nothing.
            values = values_of([e for e, _ in data])
            for axis, token in moves:
                if token.address.upper() not in values:
                    self.pos[axis] = None
            if any(e.get("wordsAreData") is True for e, _ in data):
                self.forget_all()
            return

        frame = interp.frame
        if frame is not None and moves:
            detail = "%s (line %d)" % (frame["code"], frame["line"])
            for axis, _ in moves:
                self.miss(axis, line, "frame", detail, key=frame["code"])
                self.pos[axis] = None
            self.last_polar = None
            return
        if written.words and moves:
            self.miss_axes([axis for axis, _ in moves], line, "unknown-code", written.words[0], key=written.words[0])
            for axis, _ in moves:
                self.pos[axis] = None
            return

        # Axis words that are the parameters of a cycle the block calls (`CYCL CALL POS`).
        other = self.cycle_positions(entries)
        if other:
            hit = [(axis, t) for axis, t in moves if t.address.upper() in other[0]]
            if hit:
                self.miss_axes([axis for axis, _ in hit], line, "cycle-position", other[1], key=other[1])
            for axis, _ in hit:
                self.pos[axis] = None
            moves = [(axis, t) for axis, t in moves if t.address.upper() not in other[0]]

        start = dict(self.pos)
        targets = self.resolve_moves(moves, line, units, entries, state)
        polar = bool(words.get(POLAR_ANGLE) or words.get(POLAR_RADIUS))
        if polar:
            self.polar_move(words, written, start, targets, line, units, entries, plane)
        else:
            self.last_polar = None
        self.arc(words, written, start, targets, line, units, entries, plane, state, moves)
        for axis, value in targets.items():
            if value is not None:
                self.note(axis, value, line)
            self.pos[axis] = value
        self.after_cycle(state, written, moves, line, plane)

    # -- the kinds of block ---------------------------------------------------

    def bare(self, tokens: Sequence[gedit_nc.Token], written: Written) -> bool:
        """A block that writes no value besides its codes (`TRANS` alone: a reset)."""
        values = sum(1 for t in tokens if t.kind == "word" and (t.value_text or "") != "")
        codes = sum(1 for _, _, kind in written.entries if kind == "word")
        return values <= codes

    def plane_axes(self, plane: str) -> List[str]:
        pair = PLANE_AXES.get(plane)
        return [axis for axis in (pair or ("X", "Y", "Z")) if axis in self.axes.known]

    def forget_all(self) -> None:
        for axis in self.pos:
            self.pos[axis] = None
        self.last_polar = None

    def machine_block(self, code: str, moves, line: int, units, entries) -> None:
        """A machine position: rows of its own, and the axes it moved are no longer known."""
        where = "%s (line %d)" % (code, line)
        for axis, token in moves:
            self.pos[axis] = None
            if not self.record:
                continue
            address = token.text[: len(token.text) - len(token.value_text or "")] if token.value_text else token.text
            value, _ = self.value(token, units, entries)
            self.machine_rows.append(
                {
                    "where": where,
                    "scope": "machine",
                    "axis": address.strip().rstrip("=") or axis,
                    "axisId": axis,
                    "min": self.fmt(axis, value) if value is not None else "",
                    "minLine": line if value is not None else "",
                    "max": self.fmt(axis, value) if value is not None else "",
                    "maxLine": line if value is not None else "",
                    "unresolved": 0 if value is not None else 1,
                    "line": line,
                }
            )
        self.last_polar = None

    def set_pole(self, moves, line: int, units, entries, plane: str) -> None:
        """The pole (Klartext `CC`): written coordinates, an increment, or the position."""
        pair = PLANE_AXES.get(plane)
        if pair is None:
            self.pole = {}
            return
        pole: Dict[str, Optional[Decimal]] = {}
        for axis in pair:
            pole[axis] = self.geo_pos(axis)
        for axis, token in moves:
            value, _ = self.value(token, units, entries)
            if value is None:
                pole[axis] = None
                continue
            if token.incremental:
                base = pole.get(axis)
                pole[axis] = None if base is None else base + value
            else:
                pole[axis] = value
        self.pole = {axis: v for axis, v in pole.items() if v is not None}
        self.last_polar = None

    def cycle_positions(self, entries) -> Optional[Tuple[frozenset, str]]:
        """The axis words that are a called cycle's own positions (`position: 'other'`)."""
        for entry in entries:
            params = entry.get("params")
            found = [
                str(p.get("address")).upper()
                for p in (params if isinstance(params, list) else [])
                if isinstance(p, dict) and gedit_nc.position_of(p) == "other" and isinstance(p.get("address"), str)
            ]
            hits = frozenset(a for a in found if self.axes.axis_of(a) is not None)
            if hits:
                return hits, str(entry.get("code"))
        return None

    # -- values ---------------------------------------------------------------

    def value(self, token, units, entries, number_class: Optional[str] = None) -> Tuple[Optional[Decimal], List[Dict[str, Any]]]:
        """The effective value of a word in the report's units (degrees for an angle)."""
        literal, _ = literal_of(token)
        if literal is None:
            return None, []
        cls = number_class
        if cls is None:
            # The class of an axis word depends on the block's codes (a `CodeParam.unit`) and,
            # for a feed, on the unit in force; remembered per combination, because a long
            # program asks the same question on every line.
            key = (token.address or "", tuple(id(e) for e in entries), self.interp.feed_unit, self.interp.pitch_feed)
            if key in self._classes:
                cls = self._classes[key]
            else:
                cls = gedit_nc.number_class_of(
                    token.address or "", self.profile, self.interp.feed_unit, entries, self.interp.pitch_feed
                )
                self._classes[key] = cls
        reading_key = (getattr(literal, "raw", None), bool(getattr(literal, "has_point", False)), cls, units)
        found = self._readings.get(reading_key)
        if found is None:
            found = gedit_nc.resolve_value(literal, cls, self.machine, self.profile, units or "mm")
            self._readings[reading_key] = found
        text, readings = found
        value = dec(text)
        if value is None:
            return None, readings
        if cls in ("length", "increment") and units in ("mm", "inch"):
            report = self.report_units or units
            if units == "inch" and report == "mm":
                value = value * INCH
            elif units == "mm" and report == "inch":
                value = value / INCH
        return value, []

    def resolve_moves(self, moves, line: int, units, entries, state) -> Dict[str, Optional[Decimal]]:
        """Every axis word of a positioning block, as the column value it moves to."""
        targets: Dict[str, Optional[Decimal]] = {}
        distance = state["distance"]
        for axis, token in moves:
            address = token.address.upper()
            word = "%s (line %d)" % (token.text, line)
            literal, function = literal_of(token)
            if literal is None:
                self.miss(axis, line, "expression", word)
                targets[axis] = None
                continue
            value, readings = self.value(token, units, entries)
            if value is None:
                # The text of the readings is only built for the finding that is kept: a program with
                # thousands of such words asks for one sentence, not thousands.
                angle = axis in self.axes.angular
                self.miss(axis, line, "machine-dependent", word, readings=lambda r=readings, a=angle, u=units: readings_text(r, a, u))
                targets[axis] = None
                continue
            if address in self.axes.diameter_words:
                reading = self.interp.diameter_reading(address)
                mode = as_dict(state["diameter"]).get("mode")
                if mode == "absolute-only" and function is not None:
                    # DIAM90: the word's own function decides, as the distance mode would.
                    reading = "diameter" if function == "absolute" else "radius"
                if reading == "unknown" or reading not in ("diameter", "radius"):
                    self.miss(axis, line, "diameter-unknown", word)
                    targets[axis] = None
                    continue
                if self.axes.lathe_column and reading == "radius":
                    value = value * _TWO
                elif not self.axes.lathe_column and reading == "diameter":
                    value = value / _TWO
            if address in self.axes.twins or token.incremental or function == "incremental":
                incremental = True
            elif function == "absolute":
                incremental = False
            elif distance == "incremental":
                incremental = True
            elif distance == "absolute":
                incremental = False
            else:
                self.miss(axis, line, "distance-unknown", word)
                targets[axis] = None
                continue
            if incremental:
                base = targets.get(axis) if axis in targets else self.pos.get(axis)
                if base is None:
                    if axis in self.unstated and self.called is not None:
                        self.miss(axis, line, "called-program", word, key=self.called)
                    else:
                        self.miss(axis, line, "incremental-start", word)
                    targets[axis] = None
                    continue
                value = base + value
            # NC-4: an axis a called program states is known from here on.
            self.unstated.discard(axis)
            targets[axis] = value
        return targets

    def geo_pos(self, axis: str) -> Optional[Decimal]:
        value = self.pos.get(axis)
        return None if value is None else self.axes.geo(axis, value)

    # -- arcs -----------------------------------------------------------------

    def arc(self, words, written, start, targets, line, units, entries, plane, state, moves) -> None:
        """Adds the extremes of an arc in the active plane to the ranges, or counts it."""
        direction: Optional[str] = None
        codes = [code for _, code, _ in written.entries]
        tangent = next((c for c in codes if c in UNRESOLVED_ARCS), None)
        drw = words.get(DIRECTION_WORD)
        if drw is not None and (drw.value_text or "") in ("+", "-") and tangent is None:
            direction = "ccw" if drw.value_text == "+" else "cw"
        elif tangent is None:
            motion = as_dict(state["groups"].get("motion")).get("code")
            if motion in ARC_CODES:
                direction = ARC_CODES[motion]
        if tangent is None and direction is None:
            return
        if POLAR_ANGLE in words and direction is not None:
            return  # a polar arc: `polar_move` has done it
        pair = PLANE_AXES.get(plane)
        centre_words = [w for w in self.axes.centre_words if w in words]
        in_plane = pair is not None and any(axis in pair for axis, _ in moves)
        radius_word = next((words[w] for w in RADIUS_WORDS if w in words and not zero(words[w])), None)
        if direction is not None and drw is None and not centre_words and radius_word is None and not in_plane:
            return  # a modal G2 block that moves no axis of the plane: no arc
        motion = as_dict(state["groups"].get("motion")).get("code")
        name = tangent or (codes[0] if codes else None) or motion or "arc"
        word = "%s (line %d)" % (name, line)
        if tangent is not None or pair is None:
            self.arc_miss(pair, line, word)
            return
        a, b = pair
        sa, sb = self.geo(start, a), self.geo(start, b)
        ea = self.geo(targets, a) if a in targets else sa
        eb = self.geo(targets, b) if b in targets else sb
        if a in targets and targets[a] is None or b in targets and targets[b] is None:
            self.arc_miss(pair, line, word)
            return
        if sa is None or sb is None or ea is None or eb is None:
            self.arc_miss(pair, line, word)
            return
        centre: Optional[Tuple[Decimal, Decimal]] = None
        full = False
        if radius_word is not None:
            r, _ = self.value(radius_word, units, entries, "length")
            if r is None:
                self.arc_miss(pair, line, word)
                return
            centre = centre_from_radius(sa, sb, ea, eb, r, direction)
            if centre is None:
                self.arc_miss(pair, line, word)
                return
        elif drw is not None:
            ca, cb = self.pole.get(a), self.pole.get(b)
            if ca is None or cb is None:
                self.arc_miss(pair, line, word)
                return
            centre = (ca, cb)
            full = sa == ea and sb == eb
        else:
            # Each centre word on its own: incremental from the start point by the profile's
            # `arcCenterMode`, unless a value function says otherwise (`J=AC(8.381)`). A centre
            # word left out is an offset of 0 in incremental mode, and missing in absolute.
            found: Dict[str, Decimal] = {}
            starts = {a: sa, b: sb}
            for w in centre_words:
                axis = CENTRE_AXIS[w]
                if axis not in starts:
                    continue
                value, _ = self.value(words[w], units, entries, "length")
                if value is None:
                    self.arc_miss(pair, line, word)
                    return
                _, function = literal_of(words[w])
                incremental = function == "incremental" or (function is None and self.axes.centre_incremental)
                found[axis] = starts[axis] + value if incremental else value
            if not found:
                self.arc_miss(pair, line, word)
                return
            for axis in pair:
                if axis not in found:
                    if not self.axes.centre_incremental:
                        self.arc_miss(pair, line, word)
                        return
                    found[axis] = starts[axis]
            centre = (found[a], found[b])
            full = sa == ea and sb == eb
        turns = words.get(TURNS_WORD)
        if turns is not None and turns.value is not None and dec(turns.value.raw) not in (None, _ZERO):
            full = True
        self.extremes(pair, centre, (sa, sb), (ea, eb), direction, full, line)

    def arc_miss(self, pair, line: int, word: str) -> None:
        self.miss_axes(list(pair or ("X", "Y")), line, "arc", word)

    def geo(self, table, axis: str) -> Optional[Decimal]:
        value = table.get(axis)
        return None if value is None else self.axes.geo(axis, value)

    def extremes(self, pair, centre, s, e, direction: str, full: bool, line: int, sweep: Optional[float] = None) -> None:
        a, b = pair
        ca, cb = centre
        r = distance(s[0] - ca, s[1] - cb)
        if r == _ZERO:
            return
        t0 = angle_of(s[1] - cb, s[0] - ca)
        if sweep is None:
            if full:
                sweep = 360.0 if direction == "ccw" else -360.0
            else:
                t1 = angle_of(e[1] - cb, e[0] - ca)
                if direction == "ccw":
                    sweep = (t1 - t0) % 360.0
                else:
                    sweep = -((t0 - t1) % 360.0)
        points = {0: (a, ca + r), 90: (b, cb + r), 180: (a, ca - r), 270: (b, cb - r)}
        for k, (axis, value) in points.items():
            if abs(sweep) >= 360.0 or within(t0, sweep, float(k)):
                if axis in self.axes.known:
                    self.note(axis, self.axes.col(axis, value), line)

    # -- polar moves (Klartext `LP`, `CP`, `CTP` about the pole `CC`) ---------

    def polar_move(self, words, written, start, targets, line, units, entries, plane) -> None:
        pair = PLANE_AXES.get(plane)
        codes = [code for _, code, _ in written.entries]
        word = "%s (line %d)" % (codes[0] if codes else POLAR_ANGLE, line)
        a_word, r_word = words.get(POLAR_ANGLE), words.get(POLAR_RADIUS)
        drw = words.get(DIRECTION_WORD)
        arc = drw is not None and (drw.value_text or "") in ("+", "-")

        def fail() -> None:
            self.miss_axes(list(pair or ("X", "Y")), line, "polar", word)
            for axis in pair or ("X", "Y"):
                if axis in self.axes.known:
                    targets[axis] = None
            self.last_polar = None

        if pair is None:
            fail()
            return
        a, b = pair
        ca, cb = self.pole.get(a), self.pole.get(b)
        sa, sb = self.geo(start, a), self.geo(start, b)
        if ca is None or cb is None:
            fail()
            return
        angle = radius = None
        if a_word is not None:
            angle, _ = self.value(a_word, units, entries, "angle")
            if angle is None:
                fail()
                return
        if r_word is not None:
            radius, _ = self.value(r_word, units, entries, "length")
            if radius is None:
                fail()
                return
        if arc:
            # `CP`: around the pole from where the tool is, the radius its distance to it.
            if sa is None or sb is None or angle is None:
                fail()
                return
            r = distance(sa - ca, sb - cb)
            t0 = Decimal(repr(angle_of(sb - cb, sa - ca)))
            if a_word.incremental:
                sweep = float(angle)
                end_angle = t0 + angle
            else:
                end_angle = angle
                sweep = None
            dx, dy = polar_point(r, end_angle)
            ea, eb = ca + dx, cb + dy
            direction = "ccw" if drw.value_text == "+" else "cw"
            self.extremes(pair, (ca, cb), (sa, sb), (ea, eb), direction, False, line, sweep)
            self.last_polar = (r, end_angle)
        else:
            last = self.last_polar
            if radius is None or r_word.incremental:
                if last is None:
                    fail()
                    return
                radius = last[0] + (radius if radius is not None else _ZERO)
            if angle is None or a_word.incremental:
                if last is None:
                    fail()
                    return
                angle = last[1] + (angle if angle is not None else _ZERO)
            dx, dy = polar_point(radius, angle)
            ea, eb = ca + dx, cb + dy
            self.last_polar = (radius, angle)
        targets[a] = self.axes.col(a, ea)
        targets[b] = self.axes.col(b, eb)

    # -- cycles ---------------------------------------------------------------

    def after_cycle(self, state, written, moves, line: int, plane: str) -> None:
        """What a block that runs a cycle leaves behind, and what of it is not resolved."""
        block = as_dict(state["block"])
        interp = self.interp
        running: Optional[str] = None
        if block.get("cycle"):
            running = block["cycle"]
        elif interp.active_cycle and moves:
            running = interp.active_cycle
        if running is None:
            for entry, code, _ in written.entries:
                cycle = as_dict(entry.get("sets")).get("cycle")
                if cycle in ("call", "call-modal") and interp.defined_cycle is None:
                    self.cycle_miss("%s (line %d), with no cycle the database describes defined" % (code, line), code, line, plane)
            if interp.modal_call is not None and interp.defined_cycle is None and moves:
                self.cycle_miss("%s (line %d), with no cycle the database describes defined" % (interp.modal_call["code"], line), interp.modal_call["code"], line, plane)
            return
        entry = interp.entry(running)
        cycle = as_dict(entry.get("sets")).get("cycle") if entry is not None else None
        if cycle not in ("start", "define"):
            return  # a thread move (`G32`) is a move, not a cycle
        written_axes = {axis for axis, _ in moves}
        normal = PLANE_NORMAL.get(plane)
        if plane == "XY":
            forget = {"Z"} if "Z" in self.pos else set()
        else:
            forget = set(written_axes) | set(self.plane_axes(plane))
            if normal is not None:
                forget.add(normal)
        for axis in forget:
            if axis in self.pos:
                self.pos[axis] = None
        self.last_polar = None
        # Where the cycle's positions are its parameters (a defined cycle, a call with
        # arguments), the depth it works to is in none of the block's axis words.
        if cycle == "define" or (entry is not None and self.written_as_call(written, running)):
            defined = state.get("definedCycle") or {}
            at = defined.get("line") if cycle == "define" else line
            self.cycle_miss("%s (line %d)" % (running, at or line), running, line, plane)

    def written_as_call(self, written, code: str) -> bool:
        return any(kind == "call" and c == code for _, c, kind in written.entries)

    def cycle_miss(self, detail: str, key: str, line: int, plane: str) -> None:
        axes = ["Z"] if plane == "XY" else self.plane_axes(plane)
        axes = [axis for axis in axes if axis in self.axes.known]
        label = " and ".join(self.axes.label(x) for x in axes) or "tool-axis"
        self.miss_axes(axes, line, "cycle", detail, key=key, names=label)

    # -- output ---------------------------------------------------------------

    def fmt(self, axis: str, value: Decimal) -> str:
        if axis in self.axes.angular:
            return text_of(value, DECIMALS["angle"])
        return text_of(value, DECIMALS.get(self.report_units or "mm", 4))

    def rows_of(self, scope: Scope) -> List[Dict[str, Any]]:
        out = []
        for axis in self.axes.order:
            r = scope.ranges.get(axis)
            if r is None:
                continue
            row: Dict[str, Any] = {"where": scope.where, "scope": scope.kind, "axis": self.axes.label(axis), "axisId": axis}
            if r.low is not None:
                row.update(
                    {
                        "min": self.fmt(axis, r.low),
                        "minLine": r.low_line,
                        "max": self.fmt(axis, r.high),
                        "maxLine": r.high_line,
                    }
                )
            else:
                row.update({"min": "", "minLine": "", "max": "", "maxLine": ""})
            row["unresolved"] = r.unresolved
            row["line"] = r.high_line if r.low is not None else r.first_unresolved
            out.append(row)
        return out

    def rows(self) -> List[Dict[str, Any]]:
        self.settle_held()
        out = self.rows_of(self.program)
        with_offsets = self.offset_codes > 0
        for group in self.groups:
            if group.scope.empty():
                continue
            if with_offsets:
                out.extend(self.rows_of(group.scope))
            for station in group.order:
                scope = group.tools[station]
                if scope.empty():
                    continue
                if with_offsets:
                    scope = Scope(scope.kind, "%s, %s" % (group.label.split(" (line")[0], scope.where))
                    scope.ranges = group.tools[station].ranges
                out.extend(self.rows_of(scope))
        out.extend(self.machine_rows)
        return out

    def message(self) -> str:
        self.settle_held()
        parts: List[str] = []
        if self.machine.get("id") is not None and isinstance(self.machine.get("name"), str):
            parts.append("Machine %r." % self.machine["name"])
        else:
            parts.append(
                "No machine: readings assumed from the profile defaults, and a word whose "
                "reading depends on the machine is not resolved."
            )
        if self.axes.lathe_column:
            parts.append(self.diameter_text())
        if self.units_switched:
            parts.append("The program switches units; every length is given in %s." % (self.report_units or "mm"))
        if self.program.empty() and not self.machine_rows:
            parts.append("No positions found.")
        else:
            missed = sum(r.unresolved for r in self.program.ranges.values())
            if missed:
                parts.append("%s not resolved; the findings say why." % times(missed, "position", "positions"))
        return " ".join(parts)

    def diameter_text(self) -> str:
        start = self.diameter_start or {}
        mode = start.get("mode")
        if not start.get("assumed", True) and isinstance(start.get("line"), int) and start.get("line"):
            source = "line %d" % start["line"]
        else:
            source = {
                "machine": "the machine",
                "detected": "detected in the program",
            }.get(start.get("from"), "assumed from the profile")
        if mode == "on":
            text = "X is a diameter: diameter programming is on (%s)." % source
        elif mode == "off":
            text = (
                "X is shown as a diameter: diameter programming is off at the start (%s), so "
                "a radius value counts double." % source
            )
        elif mode == "absolute-only":
            text = (
                "X is shown as a diameter: X is a diameter while positions are absolute and a "
                "radius while they are incremental (%s); a radius value counts double." % source
            )
        else:
            text = "X is shown as a diameter; the diameter mode is not known at the start."
        if self.diameter_switches:
            shown = ", ".join("%s (line %d)" % pair for pair in self.diameter_switches[:5])
            more = len(self.diameter_switches) - 5
            text += " The program switches it: %s%s; a radius value counts double." % (
                shown,
                " and %d more" % more if more > 0 else "",
            )
        return text


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


#: The parameter units of a value that is no coordinate: a time, a count, a step, an angle.
NOT_A_COORDINATE = ("dwell", "count", "increment", "angle")


def values_of(entries: Sequence[Dict[str, Any]]) -> frozenset:
    """The addresses ``entries`` declare as a value that is no coordinate (``CodeParam.unit``)."""
    out = set()
    for entry in entries:
        params = entry.get("params")
        for param in params if isinstance(params, list) else []:
            if isinstance(param, dict) and param.get("unit") in NOT_A_COORDINATE and isinstance(param.get("address"), str):
                out.add(param["address"].upper())
    return frozenset(out)


def head_of(code: Any) -> str:
    text = str(code or "")
    end = 0
    while end < len(text) and text[end].isalpha():
        end += 1
    return text[:end].upper()


def is_word_code(code: Any) -> bool:
    """`G1`, `M30`, `G84.2`: a letter and a number, the way an ISO dialect writes a code."""
    text = str(code or "")
    head = head_of(text)
    rest = text[len(head) :]
    return head != "" and rest != "" and rest.replace(".", "", 1).isdigit()


def canonical(entry: Dict[str, Any], written: str) -> str:
    code = entry.get("code")
    return code if isinstance(code, str) and code != "" else written


def zero(token: gedit_nc.Token) -> bool:
    """A radius word of 0 is no radius (Klartext `R0` is a radius-compensation word)."""
    value = gedit_nc.decimal_of(token.value) if token.value is not None else None
    return value is not None and value == 0


def within(t0: float, sweep: float, k: float) -> bool:
    """Whether the angle ``k`` lies strictly inside the sweep from ``t0``."""
    if sweep >= 0:
        d = (k - t0) % 360.0
        return 1e-9 < d < sweep - 1e-9
    d = (t0 - k) % 360.0
    return 1e-9 < d < -sweep - 1e-9


def centre_from_radius(sa, sb, ea, eb, r: Decimal, direction: str) -> Optional[Tuple[Decimal, Decimal]]:
    """The centre of an arc given by its radius: a negative radius is the arc over 180°."""
    with localcontext() as context:
        context.prec = 34
        da, db = ea - sa, eb - sb
        d2 = da * da + db * db
        if d2 == _ZERO:
            return None
        rr = abs(r)
        h2 = rr * rr - d2 / 4
        if h2 < 0:
            half = sqrt(d2) / 2
            if half - rr > CHORD_SLACK:
                return None
            h2 = _ZERO
        h = sqrt(h2) if h2 > 0 else _ZERO
        d = sqrt(d2)
        ma, mb = sa + da / 2, sb + db / 2
        # The unit normal to the left of the chord.
        na, nb = -db / d, da / d
        left = (direction == "ccw") == (r > 0)
        sign = Decimal(1) if left else Decimal(-1)
        return (rounded(ma + sign * h * na, COMPUTED), rounded(mb + sign * h * nb, COMPUTED))


def readings_text(readings: Sequence[Dict[str, Any]], angle: bool, units: Optional[str]) -> str:
    """`IS-B: 1 mm; calculator: 1000 mm`, the readings of the presets, the default first."""
    unit = "°" if angle else (" " + (units or "mm"))
    parts = []
    for reading in readings:
        label = reading.get("preset") or reading.get("label") or ""
        value = reading.get("value")
        shown = ("%s%s" % (text_of(Decimal(value), 6), unit)) if value is not None else "no value"
        parts.append("%s: %s" % (label, shown))
    return "; ".join(parts)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    context = gedit_nc.load_context()
    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Extents needs a dialect profile. Run it from gEdit, which puts the profile into "
            "the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Extents cannot use this profile: %s" % err, file=sys.stderr)
        return 1

    lines = gedit_nc.read_input()
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    first = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    above = gedit_nc.preceding_lines(context)

    walk = Extents(context, cp)
    state: Optional[gedit_nc.LineState] = None
    for number, line in enumerate(above, first - len(above)):
        state = walk.line(line, number, state, record=False)
    if scope.get("scope") == "selection" and first > 1 and not above:
        walk.findings.add("selection", first)
    # A trailing newline leaves one empty element that is not a line of the program.
    if len(lines) > 1 and lines[-1] == "":
        lines = lines[:-1]
    for number, line in enumerate(lines, first):
        state = walk.line(line, number, state, record=True)
    walk.settle_held()

    gedit_nc.report(TITLE, COLUMNS, walk.rows(), walk.message(), walk.findings.out())
    return 0


if __name__ == "__main__":
    sys.exit(main())
